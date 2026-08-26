import { Inject, Injectable } from "@nestjs/common";
import { getDb } from "@ray/database";
import { newId } from "@ray/types";
import { AppException } from "../../common/errors/app.exception";
import { RAZORPAY_ADAPTER, type RazorpayAdapter } from "./razorpay.adapter";

export interface RazorpayWebhookBody {
  event?: string;
  payload?: {
    payment?: { entity?: { order_id?: string; id?: string } };
    order?: { entity?: { id?: string } };
  };
}

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

  /**
   * Complete payment for an order. With Razorpay payment id + signature, the signature
   * is verified against the Razorpay order before marking captured. Otherwise a local
   * stub capture is used (test mode / non-Razorpay).
   */
  async payOrder(
    merchantId: string,
    orderId: string,
    opts?: { method?: string; customerId?: string; razorpayPaymentId?: string; razorpaySignature?: string },
  ) {
    const order = await this.db.order.findUnique({
      where: { id: orderId, merchantId },
      select: { id: true, totalMinor: true, currency: true, customerId: true, status: true },
    });
    if (!order) throw new AppException(404, "ORDER_NOT_FOUND", "Order not found");
    if (order.status === "PAID") {
      return { id: order.id, status: order.status as string, totalMinor: order.totalMinor, currency: order.currency };
    }

    if (opts?.razorpayPaymentId && opts?.razorpaySignature) {
      const payment = await this.db.payment.findFirst({
        where: { orderId, merchantId, razorpayOrderId: { not: null } },
        select: { id: true, razorpayOrderId: true },
      });
      if (!payment?.razorpayOrderId) {
        throw new AppException(409, "NO_RAZORPAY_ORDER", "No Razorpay order to verify against");
      }
      const ok = this.razorpay.verifyPaymentSignature(payment.razorpayOrderId, opts.razorpayPaymentId, opts.razorpaySignature);
      if (!ok) throw new AppException(400, "INVALID_SIGNATURE", "Payment signature verification failed");
      await this.db.payment.update({
        where: { id: payment.id },
        data: { state: "CAPTURED", razorpayPaymentId: opts.razorpayPaymentId, capturedAt: new Date() },
      });
    } else {
      // ponytail: local stub capture; webhook ingestion (Task 56) is the canonical confirm path.
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
    }

    const updated = await this.db.order.update({
      where: { id: orderId, merchantId },
      data: { status: "PAID" },
      select: { id: true, status: true, totalMinor: true, currency: true },
    });
    return updated;
  }

  /** Razorpay webhook entry point. Verifies the signature upstream, then confirms capture. */
  async handleRazorpayWebhook(event: RazorpayWebhookBody): Promise<{ ok: boolean }> {
    const rzOrderId = event?.payload?.payment?.entity?.order_id ?? event?.payload?.order?.entity?.id;
    if (!rzOrderId) return { ok: false };
    await this.confirmRazorpayOrder(rzOrderId);
    return { ok: true };
  }

  /** Mark the payment + order paid by Razorpay order id. Idempotent across webhook retries. */
  async confirmRazorpayOrder(razorpayOrderId: string): Promise<void> {
    const payment = await this.db.payment.findFirst({
      where: { razorpayOrderId },
      select: { id: true, merchantId: true, orderId: true, state: true },
    });
    if (!payment || payment.state === "CAPTURED") return;
    await this.db.payment.update({ where: { id: payment.id }, data: { state: "CAPTURED", capturedAt: new Date() } });
    await this.db.order.update({ where: { id: payment.orderId, merchantId: payment.merchantId }, data: { status: "PAID" } });
  }
}
