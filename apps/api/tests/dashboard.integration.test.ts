import assert from "node:assert/strict";
import "reflect-metadata";
import { test } from "node:test";
import { config as loadEnv } from "dotenv";
loadEnv({ path: "../../.env" });
import { randomUUID } from "node:crypto";
import { getDb } from "@ray/database";
import { DashboardService } from "../src/modules/dashboard/dashboard.service";
import { PaymentService } from "../src/modules/payments/payment.service";
import { RazorpayAdapter, razorpayConfigFromEnv } from "../src/modules/payments/razorpay.adapter";

// Skips when no database is configured so local `pnpm test` without infra stays green.
const dbConfigured = Boolean(process.env.DATABASE_URL);

const rid = () => randomUUID().replace(/-/g, "").slice(0, 20);

test("dashboard summary reflects seeded merchant data", { skip: !dbConfigured }, async () => {
  const db = getDb();
  const merchantId = `merchant_${rid()}`;
  await db.merchant.create({ data: { id: merchantId, name: "M", slug: `m-${rid()}` } });
  const websiteId = `site_${rid()}`;
  await db.website.create({
    data: { id: websiteId, merchantId, publicKey: `pk_${rid()}`, url: "https://x.com", hostname: "x.com", status: "READY" },
  });
  await db.product.create({
    data: { id: `prod_${rid()}`, merchantId, websiteId, name: "Shoe", priceMinor: 1000, currency: "INR", sourceUrl: `https://x.com/${rid()}` },
  });
  const customerId = `cust_${rid()}`;
  await db.customer.create({ data: { id: customerId, merchantId, email: "a@b.com" } });
  const conversationId = `conv_${rid()}`;
  await db.conversation.create({ data: { id: conversationId, merchantId, status: "ACTIVE" } });
  const cartId = `cart_${rid()}`;
  await db.cart.create({
    data: { id: cartId, merchantId, customerId, currency: "INR", status: "CONVERTED", conversationId },
  });
  const orderId = `order_${rid()}`;
  await db.order.create({
    data: { id: orderId, merchantId, customerId, cartId, status: "PAID", subtotalMinor: 1000, totalMinor: 1000, currency: "INR" },
  });

  const svc = new DashboardService();
  const s = await svc.summary(merchantId);
  assert.equal(s.products, 1);
  assert.equal(s.customers, 1);
  assert.equal(s.orders, 1);
  assert.equal(s.convertedCarts, 1);
  assert.equal(s.revenueMinor, 1000);
  assert.equal(s.currency, "INR");
  assert.equal(s.ordersByStatus.PAID, 1);
  // ponytail: this cart came from an AI conversation -> AI revenue should equal the paid total
  assert.equal(s.aiRevenueMinor, 1000);
});

test("webhook marks a CREATED order PAID and its payment CAPTURED (Task 62 E2E surrogate)", { skip: !dbConfigured }, async () => {
  const db = getDb();
  const merchantId = `merchant_${rid()}`;
  await db.merchant.create({ data: { id: merchantId, name: "M", slug: `m-${rid()}` } });
  const orderId = `order_${rid()}`;
  const rzOrderId = `rz_${rid()}`;
  await db.order.create({
    data: { id: orderId, merchantId, status: "CREATED", subtotalMinor: 500, totalMinor: 500, currency: "INR" },
  });
  await db.payment.create({
    data: { id: `pay_${rid()}`, merchantId, orderId, state: "CREATED", amountMinor: 500, currency: "INR", razorpayOrderId: rzOrderId, method: "razorpay" },
  });

  const pay = new PaymentService(new RazorpayAdapter(razorpayConfigFromEnv()));
  const res = await pay.handleRazorpayWebhook({
    event: "payment.captured",
    payload: { payment: { entity: { order_id: rzOrderId, id: "pay_x" } } },
  } as never);
  assert.equal(res.ok, true);

  const order = await db.order.findUnique({ where: { id: orderId, merchantId }, select: { status: true } });
  assert.equal(order?.status, "PAID");
  const payment = await db.payment.findFirst({ where: { razorpayOrderId: rzOrderId }, select: { state: true } });
  assert.equal(payment?.state, "CAPTURED");
});
