import { Injectable } from "@nestjs/common";
import { getDb } from "@ray/database";

export interface DashboardSummary {
  products: number;
  orders: number;
  customers: number;
  newCustomers30d: number;
  identifiedCustomers: number;
  conversations: number;
  activeConversations: number;
  totalMessages: number;
  avgMessagesPerConversation: number;
  topProducts: { productId: string; title: string; unitsSold: number }[];
  newProducts30d: number;
  cartsTotal: number;
  convertedCarts: number;
  cartConversionRate: number;
  conversationToOrderRate: number;
  revenueMinor: number;
  aiRevenueMinor: number;
  averageOrderValueMinor: number;
  ordersByStatus: Record<string, number>;
  currency: string | null;
}

@Injectable()
export class DashboardService {
  private readonly db = getDb();

  /** Merchant-scoped summary for the desktop dashboard. Analytics depth is Phase 6 Tasks 64-70. */
  async summary(merchantId: string): Promise<DashboardSummary> {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [products, orders, customers, newCustomers30d, identifiedCustomers, conversations, activeConversations, totalMessages, newProducts30d, cartsTotal, convertedCarts, topAgg, paidAgg, aiAgg, aovAgg, byStatus, sample] =
      await Promise.all([
        this.db.product.count({ where: { merchantId, deletedAt: null } }),
        this.db.order.count({ where: { merchantId } }),
        this.db.customer.count({ where: { merchantId, deletedAt: null } }),
        this.db.customer.count({ where: { merchantId, deletedAt: null, createdAt: { gte: since } } }),
        this.db.customer.count({
          where: { merchantId, deletedAt: null, OR: [{ email: { not: null } }, { phone: { not: null } }] },
        }),
        this.db.conversation.count({ where: { merchantId } }),
        this.db.conversation.count({ where: { merchantId, status: "ACTIVE" } }),
        this.db.conversationMessage.count({ where: { conversation: { merchantId } } }),
        this.db.product.count({ where: { merchantId, deletedAt: null, createdAt: { gte: since } } }),
        this.db.cart.count({ where: { merchantId } }),
        this.db.cart.count({ where: { merchantId, status: "CONVERTED" } }),
        // Top-selling products by units from paid orders.
        this.db.orderItem.groupBy({
          by: ["productId"],
          where: { order: { merchantId, status: "PAID" } },
          _sum: { quantity: true },
          orderBy: { _sum: { quantity: "desc" } },
          take: 5,
        }),
        this.db.order.aggregate({ where: { merchantId, status: "PAID" }, _sum: { totalMinor: true } }),
        // AI-attributed revenue: paid orders whose cart came from an AI conversation (Cart.conversationId).
        this.db.order.aggregate({
          where: { merchantId, status: "PAID", cart: { conversationId: { not: null } } },
          _sum: { totalMinor: true },
        }),
        this.db.order.aggregate({ where: { merchantId, status: "PAID" }, _avg: { totalMinor: true } }),
        this.db.order.groupBy({ by: ["status"], where: { merchantId }, _count: { _all: true } }),
        // ponytail: single-currency assumption; multi-currency roll-up lands in Task 64.
        this.db.order.findFirst({
          where: { merchantId, status: "PAID" },
          select: { currency: true },
          orderBy: { createdAt: "desc" },
        }),
      ]);

    const ordersByStatus: Record<string, number> = {};
    for (const row of byStatus) ordersByStatus[row.status] = row._count._all;

    // ponytail: title uses current Product.name; order-time titleSnapshot would need a join if names change.
    const names = topAgg.length
      ? await this.db.product.findMany({
          where: { id: { in: topAgg.map((t) => t.productId) } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(names.map((n) => [n.id, n.name]));
    const topProducts = topAgg.map((t) => ({
      productId: t.productId,
      title: nameById.get(t.productId) ?? "Unknown",
      unitsSold: t._sum.quantity ?? 0,
    }));

    return {
      products,
      orders,
      customers,
      newCustomers30d,
      identifiedCustomers,
      conversations,
      activeConversations,
      totalMessages,
      avgMessagesPerConversation: conversations ? Math.round((totalMessages / conversations) * 10) / 10 : 0,
      topProducts,
      newProducts30d,
      cartsTotal,
      convertedCarts,
      cartConversionRate: cartsTotal ? Math.round((convertedCarts / cartsTotal) * 1000) / 1000 : 0,
      conversationToOrderRate: conversations ? Math.round((orders / conversations) * 1000) / 1000 : 0,
      revenueMinor: paidAgg._sum.totalMinor ?? 0,
      aiRevenueMinor: aiAgg._sum.totalMinor ?? 0,
      averageOrderValueMinor: Math.round(aovAgg._avg.totalMinor ?? 0),
      ordersByStatus,
      currency: sample?.currency ?? null,
    };
  }
}
