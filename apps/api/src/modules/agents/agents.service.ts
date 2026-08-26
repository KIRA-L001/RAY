import { Injectable, Inject } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { getDb, type Json } from "@ray/database";
import { DashboardService } from "../dashboard/dashboard.service";
import { AgentRuntimeService } from "../ai-buyer/agent-runtime.service";

export type AgentName = "growth" | "recovery" | "insights" | "checkout";
const AGENTS: AgentName[] = ["growth", "recovery", "insights", "checkout"];

// ponytail: Prisma types nullable columns in a compound-unique `where` as required strings,
// so ref-less opportunities use a sentinel. Swap for a dedicated unique key if it matters later.
const NO_REF = "__none__";

interface OpportunityInput {
  merchantId: string;
  type: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  refType?: string | null;
  refId?: string | null;
  evidence?: Json;
  recommendation?: string;
}

@Injectable()
export class AgentsService {
  private readonly db = getDb();

  constructor(
    @Inject(DashboardService) private readonly dashboard: DashboardService,
    @Inject(AgentRuntimeService) private readonly runtime: AgentRuntimeService,
  ) {}

  async runAll(merchantId: string): Promise<Record<AgentName, number>> {
    const out = {} as Record<AgentName, number>;
    for (const agent of AGENTS) out[agent] = await this.run(merchantId, agent);
    return out;
  }

  async run(merchantId: string, agent: AgentName): Promise<number> {
    // Trace every merchant agent run through the shared runtime (Task 71).
    const runId = await this.runtime.start(agent.toUpperCase(), { merchantId });
    try {
      let count: number;
      switch (agent) {
        case "growth":
          count = await this.growth(merchantId);
          break;
        case "recovery":
          count = await this.recovery(merchantId);
          break;
        case "insights":
          count = await this.insights(merchantId);
          break;
        case "checkout":
          count = await this.checkout(merchantId);
          break;
      }
      await this.runtime.finish(runId, "SUCCEEDED");
      return count;
    } catch (err) {
      await this.runtime.finish(runId, "FAILED");
      throw err;
    }
  }

  // ponytail: deterministic thresholds over existing analytics; no LLM, no external calls.
  private async growth(merchantId: string): Promise<number> {
    const s = await this.dashboard.summary(merchantId);
    let n = 0;
    if (s.cartsTotal > 0 && s.cartConversionRate < 0.2) {
      n += await this.upsert({
        merchantId,
        type: "CHECKOUT_FUNNEL",
        severity: "MEDIUM",
        evidence: { cartConversionRate: s.cartConversionRate, cartsTotal: s.cartsTotal },
        recommendation: "Cart conversion is low; review checkout friction.",
      });
    }
    const top = s.topProducts[0];
    if (top && top.unitsSold >= 5) {
      n += await this.upsert({
        merchantId,
        type: "DEMAND_SPIKE",
        severity: "LOW",
        refType: "PRODUCT",
        refId: top.productId,
        evidence: { unitsSold: top.unitsSold, title: top.title },
        recommendation: `Strong demand for "${top.title}".`,
      });
    }
    return n;
  }

  // ponytail: stages recovery opportunities only; consent policy + WhatsApp send is Phase 9.
  private async recovery(merchantId: string): Promise<number> {
    const carts = await this.db.cart.findMany({
      where: { merchantId, status: "ABANDONED", customerId: { not: null } },
      select: { id: true, customerId: true },
      take: 100,
    });
    // doc #24: only recover carts whose customer is identifiable (has contact info).
    // ponytail: consent + cooldown + channel gating is Phase 9 (WhatsApp); this is the
    // deterministic identifiability gate.
    const customerIds = carts.map((c) => c.customerId).filter((id): id is string => Boolean(id));
    const reachable = new Set(
      (
        await this.db.customer.findMany({
          where: { id: { in: customerIds }, OR: [{ email: { not: null } }, { phone: { not: null } }] },
          select: { id: true },
        })
      ).map((c) => c.id),
    );
    let n = 0;
    for (const c of carts) {
      if (!c.customerId || !reachable.has(c.customerId)) continue;
      n += await this.upsert({
        merchantId,
        type: "CART_RECOVERY",
        severity: "MEDIUM",
        refType: "CART",
        refId: c.id,
        evidence: { cartId: c.id },
        recommendation: "Abandoned cart with identifiable customer; eligible for recovery.",
      });
    }
    return n;
  }

  private async insights(merchantId: string): Promise<number> {
    const s = await this.dashboard.summary(merchantId);
    let n = 0;
    if (s.customers > 0 && s.identifiedCustomers / s.customers < 0.3) {
      n += await this.upsert({
        merchantId,
        type: "CUSTOMER_IDENTIFICATION",
        severity: "LOW",
        evidence: { identified: s.identifiedCustomers, total: s.customers },
        recommendation: "Few customers are identified; capture contact earlier.",
      });
    }
    if (s.conversations > 0 && s.conversationToOrderRate < 0.1) {
      n += await this.upsert({
        merchantId,
        type: "CONVERSATION_CONVERSION",
        severity: "MEDIUM",
        evidence: { conversationToOrderRate: s.conversationToOrderRate, conversations: s.conversations },
        recommendation: "Conversations rarely convert; tune recommendations.",
      });
    }
    if (s.abandonedCarts > 0 && s.recoverableRevenueMinor > 0) {
      n += await this.upsert({
        merchantId,
        type: "ABANDONED_CART_BACKLOG",
        severity: s.abandonedCarts > 10 ? "HIGH" : "MEDIUM",
        evidence: { abandonedCarts: s.abandonedCarts, recoverableRevenueMinor: s.recoverableRevenueMinor },
        recommendation: "Abandoned carts represent recoverable revenue; enable recovery flows.",
      });
    }
    return n;
  }

  // ponytail: live checkout is handled by the pay_order tool; agent only flags OPEN carts with a known customer.
  private async checkout(merchantId: string): Promise<number> {
    const carts = await this.db.cart.findMany({
      where: { merchantId, status: "OPEN", customerId: { not: null } },
      select: { id: true },
      take: 100,
    });
    let n = 0;
    for (const c of carts) {
      n += await this.upsert({
        merchantId,
        type: "READY_TO_CHECKOUT",
        severity: "LOW",
        refType: "CART",
        refId: c.id,
        evidence: { cartId: c.id },
        recommendation: "Cart has a known customer and is open; nudge to checkout.",
      });
    }
    return n;
  }

  private async upsert(o: OpportunityInput): Promise<number> {
    try {
      await this.db.growthOpportunity.upsert({
        where: {
          merchantId_type_refType_refId: {
            merchantId: o.merchantId,
            type: o.type,
            refType: o.refType ?? NO_REF,
            refId: o.refId ?? NO_REF,
          },
        },
        create: {
          id: randomUUID(),
          merchantId: o.merchantId,
          type: o.type,
          severity: o.severity,
          refType: o.refType ?? NO_REF,
          refId: o.refId ?? NO_REF,
          evidence: o.evidence ?? undefined,
          recommendation: o.recommendation ?? undefined,
          status: "OPEN",
        },
        update: {
          evidence: o.evidence ?? undefined,
          recommendation: o.recommendation ?? undefined,
        },
      });
      return 1;
    } catch {
      return 0;
    }
  }

  async listOpportunities(merchantId: string, status?: string) {
    return this.db.growthOpportunity.findMany({
      where: { merchantId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }
}
