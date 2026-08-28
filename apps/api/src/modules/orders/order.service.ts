import { Injectable } from "@nestjs/common";
import { getDb } from "@ray/database";
import { newId } from "@ray/types";
import { AppException } from "../../common/errors/app.exception";

@Injectable()
export class OrderService {
  private readonly db = getDb();

  /** Convert a tenant-scoped cart into an order. Payments are out of scope (status CREATED). */
  async createFromCart(merchantId: string, cartId: string, customerId?: string, idempotencyKey?: string) {
    if (idempotencyKey) {
      const existing = await this.db.order.findFirst({
        where: { merchantId, idempotencyKey },
        select: { id: true, totalMinor: true, currency: true, status: true },
      });
      if (existing) return existing;
    }
    const cart = await this.db.cart.findUnique({
      where: { id: cartId, merchantId },
      select: {
        id: true,
        currency: true,
        customerId: true,
        sessionId: true,
        items: {
          select: {
            productId: true,
            variantId: true,
            quantity: true,
            unitPriceMinor: true,
            product: { select: { name: true } },
          },
        },
      },
    });
    if (!cart) throw new AppException(404, "CART_NOT_FOUND", "Cart not found");
    if (cart.items.length === 0) throw new AppException(409, "CART_EMPTY", "Cart has no items");

    const items = cart.items.map((it) => ({
      productId: it.productId,
      variantId: it.variantId,
      quantity: it.quantity,
      unitPriceMinor: it.unitPriceMinor,
      titleSnapshot: it.product.name,
    }));
    const subtotal = items.reduce((sum, i) => sum + i.unitPriceMinor * i.quantity, 0);

    // ponytail: no tax/shipping/discount yet; total == subtotal. Add a pricing step before production.
    const order = await this.db.order.create({
      data: {
        id: newId("order"),
        merchantId,
        customerId: customerId ?? cart.customerId,
        cartId: cart.id,
        sessionId: cart.sessionId,
        status: "CREATED",
        subtotalMinor: subtotal,
        totalMinor: subtotal,
        currency: cart.currency,
        idempotencyKey: idempotencyKey ?? null,
        items: { create: items.map((i) => ({ ...i, id: newId("oi") })) },
      },
      select: { id: true, totalMinor: true, currency: true, status: true },
    });
    return order;
  }

  async getOrder(merchantId: string, orderId: string) {
    const order = await this.db.order.findUnique({
      where: { id: orderId, merchantId },
      select: {
        id: true,
        status: true,
        totalMinor: true,
        currency: true,
        createdAt: true,
        items: { select: { id: true, titleSnapshot: true, quantity: true, unitPriceMinor: true } },
      },
    });
    if (!order) throw new AppException(404, "ORDER_NOT_FOUND", "Order not found");
    return order;
  }

  async listOrders(merchantId: string, filter: { customerId?: string; sessionId?: string }) {
    // ponytail: no pagination/cursor yet; recent 20 by customer or session.
    return this.db.order.findMany({
      where: {
        merchantId,
        ...(filter.customerId
          ? { customerId: filter.customerId }
          : filter.sessionId
            ? { sessionId: filter.sessionId }
            : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, status: true, totalMinor: true, currency: true, createdAt: true },
    });
  }
}
