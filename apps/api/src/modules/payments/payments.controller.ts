import { Controller, Headers, Inject, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { RAZORPAY_ADAPTER, type RazorpayAdapter } from "./razorpay.adapter";
import { type RazorpayWebhookBody, PaymentService } from "./payment.service";

interface RawBodyRequest extends FastifyRequest {
  rawBody?: Buffer;
}

@Controller("payments/webhooks")
export class PaymentsController {
  constructor(
    @Inject(RAZORPAY_ADAPTER) private readonly razorpay: RazorpayAdapter,
    private readonly payments: PaymentService,
  ) {}

  @Post("razorpay")
  async razorpayWebhook(
    @Req() req: RawBodyRequest,
    @Headers("x-razorpay-signature") signature: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const raw = req.rawBody;
    if (!raw || !signature) return { ok: false, error: "missing_signature" };
    const ok = this.razorpay.verifyWebhookSignature(raw.toString("utf8"), signature);
    if (!ok) return { ok: false, error: "invalid_signature" };
    return this.payments.handleRazorpayWebhook(req.body as RazorpayWebhookBody);
  }
}
