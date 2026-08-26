import { Injectable } from "@nestjs/common";
import { getDb } from "@ray/database";

export interface DashboardSummary {
  products: number;
  orders: number;
  customers: number;
  conversations: number;
  revenueMinor: number;
  currency: string | null;
}

@Injectable()
export class DashboardService {
  private readonly db = getDb();

  /** Merchant-scoped summary for the desktop dashboard. Analytics depth is Phase 6 Tasks 64-70. */
  async summary(merchantId: string): Promise<DashboardSummary> {
    const [products, orders, customers, conversations, paidAgg, sample] = await Promise.all([
      this.db.product.count({ where: { merchantId, deletedAt: null } }),
      this.db.order.count({ where: { merchantId } }),
      this.db.customer.count({ where: { merchantId, deletedAt: null } }),
      this.db.conversation.count({ where: { merchantId } }),
      this.db.order.aggregate({ where: { merchantId, status: "PAID" }, _sum: { totalMinor: true } }),
      // ponytail: single-currency assumption; multi-currency roll-up lands in Task 64.
      this.db.order.findFirst({
        where: { merchantId, status: "PAID" },
        select: { currency: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return {
      products,
      orders,
      customers,
      conversations,
      revenueMinor: paidAgg._sum.totalMinor ?? 0,
      currency: sample?.currency ?? null,
    };
  }
}
