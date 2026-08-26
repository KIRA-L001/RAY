import { Injectable } from "@nestjs/common";
import { getDb } from "@ray/database";
import { newId } from "@ray/types";
import { AppException } from "../../common/errors/app.exception";

@Injectable()
export class PaymentService {
  private readonly db = getDb();

  /** Record a successful payment for an order and mark it paid. No real PSP yet. */
  async payOrder(merchantId: string, orderId: string, opts?: { method?: string; customerId?: string }) {
    const order = await this.db.order.findUnique({
      where: { id: orderId, merchantId },
      select: { id: true, totalMinor: true, currency: true, customerId: true, status: true },
    });
    if (!order) throw new AppException(404, "ORDER_NOT_FOUND", "Order not found");
    if (order.status === "PAID") return { id: order.id, status: order.status as string, totalMinor: order.totalMinor, currency: order.currency };

    // ponytail: local capture only. Real flow: create Razorpay order, verify payment.signature
    // via webhook, then set CAPTURED. No money moves here.
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
