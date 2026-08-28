import assert from "node:assert/strict";
import "reflect-metadata";
import { test } from "node:test";
import { config as loadEnv } from "dotenv";
loadEnv({ path: "../../.env" });
import { getDb } from "@ray/database";
import { CatalogService } from "../src/modules/catalog/catalog.service";
import { CartService } from "../src/modules/cart/cart.service";
import { OrderService } from "../src/modules/orders/order.service";
import { PaymentService } from "../src/modules/payments/payment.service";

const dbConfigured = Boolean(process.env.DATABASE_URL);
const rid = () => Math.random().toString(36).slice(2, 10);

test("golden path: catalog -> cart -> order -> payment lands as PAID", { skip: !dbConfigured }, async () => {
  const db = getDb();
  const merchantId = `m_${rid()}`;
  const websiteId = `w_${rid()}`;
  const productId = `p_${rid()}`;
  const customerId = `u_${rid()}`;
  await db.merchant.create({ data: { id: merchantId, name: "M", slug: `s-${rid()}` } });
  await db.website.create({
    data: { id: websiteId, merchantId, publicKey: `pk_${rid()}`, url: "https://x.com", hostname: "x.com", status: "READY" },
  });
  await db.product.create({
    data: { id: productId, merchantId, websiteId, name: "Red Shoe", priceMinor: 1999, currency: "INR", sourceUrl: "https://x.com/p" },
  });
  await db.customer.create({ data: { id: customerId, merchantId, email: `${customerId}@ex.com` } });

  const catalog = new CatalogService();
  const results = (await catalog.searchProducts(merchantId, "shoe")) as Array<{ id: string }>;
  assert.ok(results.some((r) => r.id === productId), "catalog returns the seeded product");

  const cart = new CartService();
  const created = await cart.create({
    merchantId,
    customerId,
    currency: "INR",
    items: [{ productId, quantity: 1 }],
  });
  assert.equal(created.items.length, 1);

  const orders = new OrderService();
  const order = await orders.createFromCart(merchantId, created.id, customerId, `golden-${rid()}`);
  assert.equal(order.status, "CREATED");

  const payments = new PaymentService({} as unknown as import("../src/modules/payments/razorpay.adapter").RazorpayAdapter);
  const paid = await payments.payOrder(merchantId, order.id, { method: "manual", customerId });
  assert.equal(paid.status, "PAID");

  const final = await orders.getOrder(merchantId, order.id);
  assert.equal(final.status, "PAID");
  const paymentCount = await db.payment.count({ where: { orderId: order.id, merchantId } });
  assert.equal(paymentCount, 1);
});
