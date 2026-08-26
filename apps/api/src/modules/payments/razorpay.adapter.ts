import Razorpay from "razorpay";
import crypto from "crypto";

export const RAZORPAY_ADAPTER = Symbol("RAZORPAY_ADAPTER");

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  testMode: boolean;
}

export function razorpayConfigFromEnv(): RazorpayConfig {
  return {
    keyId: process.env.RAZORPAY_KEY_ID ?? "",
    keySecret: process.env.RAZORPAY_KEY_SECRET ?? "",
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? "",
    // ponytail: defaults to test mode; set RAZORPAY_TEST_MODE=false for live.
    testMode: process.env.RAZORPAY_TEST_MODE !== "false",
  };
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
}

export class RazorpayAdapter {
  private client?: Razorpay;

  constructor(private readonly config: RazorpayConfig) {}

  get testMode(): boolean {
    return this.config.testMode;
  }

  /** amountMinor is the currency's smallest unit (e.g. paise for INR). */
  async createOrder(amountMinor: number, currency: string, receipt: string): Promise<RazorpayOrder> {
    if (!this.client) this.client = new Razorpay({ key_id: this.config.keyId, key_secret: this.config.keySecret });
    const order = await this.client.orders.create({ amount: amountMinor, currency, receipt, partial_payment: false });
    const amount = typeof order.amount === "string" ? Number(order.amount) : order.amount;
    return { id: order.id, amount, currency: order.currency, receipt: order.receipt ?? "", status: order.status };
  }

  verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
    if (!this.config.keySecret) return false;
    const body = `${orderId}|${paymentId}`;
    const expected = crypto.createHmac("sha256", this.config.keySecret).update(body).digest("hex");
    return expected === signature;
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    if (!this.config.webhookSecret) return false;
    const expected = crypto.createHmac("sha256", this.config.webhookSecret).update(rawBody).digest("hex");
    return expected === signature;
  }
}
