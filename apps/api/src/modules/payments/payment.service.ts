import { Inject, Injectable } from "@nestjs/common";
import { getDb } from "@ray/database";
import { newId } from "@ray/types";
import { AppException } from "../../common/errors/app.exception";
import { RAZORPAY_ADAPTER, type RazorpayAdapter } from "./razorpay.adapter";

@Injectable()
export class PaymentService {
  private readonly db = getDb();

  // tsx/esbuild does not emit decorator metadata, so injected deps use explicit @Inject.
  constructor(@Inject(RAZORPAY_ADAPTER) private readonly razorpay: RazorpayAdapter) {}

  /**
   * Create a Razorpay order for an existing internal order and persist its id on a
   * CREATED Payment. Idempotent: reuses an existing razorpayOrderId.
   */
  async createRazorpayOrder(merchantId: string, orderId: string) {
    const order = await this.db.order.findUnique({
      where: { id: orderId, merchantId },
      select: { id: true, totalMinor: true, currency: true, customerId: true },
    });
    if (!order) throw new AppException(404, "ORDER_NOT_FOUND", "Order not found");

    const existing = await this.db.payment.findFirst({
      where: { orderId, merchantId, razorpayOrderId: { not: null } },
      select: { razorpayOrderId: true },
    });
    if (existing?.razorpayOrderId) {
      return { orderId, razorpayOrderId: existing.razorpayOrderId, amountMinor: order.totalMinor, currency: order.currency };
    }

    const rzOrder = await this.razorpay.createOrder(order.totalMinor, order.currency, order.id);
    await this.db.payment.create({
      data: {
        id: newId("pay"),
        merchantId,
        orderId,
        state: "CREATED",
        amountMinor: order.totalMinor,
        currency: order.currency,
        method: "razorpay",
        customerId: order.customerId,
        razorpayOrderId: rzOrder.id,
      },
    });
    return { orderId, razorpayOrderId: rzOrder.id, amountMinor: order.totalMinor, currency: order.currency };
  }

  /** Record a successful payment for an order and mark it paid. No real PSP yet. */
  async payOrder(merchantId: string, orderId: string, opts?: { method?: string; customerId?: string }) {
    const order = await this.db.order.findUnique({
      where: { id: orderId, merchantId },
      select: { id: true, totalMinor: true, currency: true, customerId: true, status: true },
    });
    if (!order) throw new AppException(404, "ORDER_NOT_FOUND", "Order not found");
    if (order.status === "PAID") return { id: order.id, status: order.status as string, totalMinor: order.totalMinor, currency: order.currency };

    // ponytail: local capture only. Real flow: verify payment.signature via webhook, then set CAPTURED.
    await this.db.payment.create({
      data: {
        id: newId("pay"),
        merchantId,
        orderId,
        state: "CAPTURED",
        amountMinor: order.totalMinor,
        currency: order.currency,
        method: opts?.method ?? "manual",
        customerId: opts?.customerId ?? order.customerId,
        capturedAt: new Date(),
      },
    });
    const updated = await this.db.order.update({
      where: { id: orderId, merchantId },
      data: { status: "PAID" },
      select: { id: true, status: true, totalMinor: true, currency: true },
    });
    return updated;
  }
}
