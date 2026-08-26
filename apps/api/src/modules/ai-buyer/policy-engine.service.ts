import { Injectable } from "@nestjs/common";

export interface PolicyContext {
  merchantId: string;
}

export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
}

@Injectable()
export class PolicyEngine {
  // ponytail: single in-memory default policy. Persist per-merchant policies
  // (a MerchantPolicy store) when real per-tenant config is needed; the gate
  // below stays the same.
  private readonly defaults = { maxDiscountPercent: 10 };

  /** Gate a tool request before it reaches a business service (doc #16). */
  async authorize(toolName: string, args: Record<string, unknown>): Promise<PolicyDecision> {
    const raw = args as Record<string, unknown>;
    const discount =
      typeof raw.discountPercent === "number"
        ? raw.discountPercent
        : typeof raw.discount === "number"
          ? raw.discount
          : 0;
    if (discount > this.defaults.maxDiscountPercent) {
      return { allowed: false, reason: `discount exceeds max ${this.defaults.maxDiscountPercent}%` };
    }
    return { allowed: true };
  }
}
