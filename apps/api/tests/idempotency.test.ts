import assert from "node:assert/strict";
import "reflect-metadata";
import { test } from "node:test";
import { config as loadEnv } from "dotenv";
loadEnv({ path: "../../.env" });
import { getDb } from "@ray/database";
import { OrderService } from "../src/modules/orders/order.service";
import { PaymentService } from "../src/modules/payments/payment.service";

const dbConfigured = Boolean(process.env.DATABASE_URL);
const rid = () => Math.random().toString(36).slice(2, 10);

async function seedChain() {
  const db = getDb();
  const merchantId = `m_${rid()}`;
  const websiteId = `w_${rid()}`;
  const productId = `p_${rid()}`;
  const cartId = `c_${rid()}`;
  await db.merchant.create({ data: { id: merchantId, name: "M", slug: `s-${rid()}` } });
  await db.website.create({
    data: { id: websiteId, merchantId, publicKey: `pk_${rid()}`, url: "https://x.com", hostname: "x.com", status: "READY" },
  });
  await db.product.create({
    data: { id: productId, merchantId, websiteId, name: "Shoe", priceMinor: 1000, currency: "INR", sourceUrl: "https://x.com/p" },
  });
  await db.cart.create({ data: { id: cartId, merchantId, currency: "INR", status: "OPEN" } });
  await db.cartItem.create({
    data: { id: `ci_${rid()}`, cartId, productId, quantity: 1, unitPriceMinor: 1000 },
  });
  return { merchantId, cartId };
}

test("createFromCart is idempotent on a caller-supplied key", { skip: !dbConfigured }, async () => {
  const { merchantId, cartId } = await seedChain();
  const svc = new OrderService();
  const a = await svc.createFromCart(merchantId, cartId, undefined, "key-1");
  const b = await svc.createFromCart(merchantId, cartId, undefined, "key-1");
  assert.equal(b.id, a.id, "same key returns the same order");
  const c = await svc.createFromCart(merchantId, cartId, undefined, "key-2");
  assert.notEqual(c.id, a.id, "different key creates a new order");
});

test("payOrder does not double-capture under repeated submission", { skip: !dbConfigured }, async () => {
  const { merchantId, cartId } = await seedChain();
  const orders = new OrderService();
  const order = await orders.createFromCart(merchantId, cartId, undefined, "pay-key-1");
  const payments = new PaymentService({} as unknown as import("../src/modules/payments/razorpay.adapter").RazorpayAdapter);
  await payments.payOrder(merchantId, order.id, { idempotencyKey: "pay-key-1" });
  await payments.payOrder(merchantId, order.id, { idempotencyKey: "pay-key-1" });
  const count = await getDb().payment.count({ where: { merchantId, idempotencyKey: "pay-key-1" } });
  assert.equal(count, 1, "only one payment captured for the same idempotency key");
});
