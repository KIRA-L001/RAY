import assert from "node:assert/strict";
import "reflect-metadata";
import { test } from "node:test";
import { config as loadEnv } from "dotenv";
loadEnv({ path: "../../.env" });
import { randomUUID } from "node:crypto";
import { getDb } from "@ray/database";
import { DashboardService } from "../src/modules/dashboard/dashboard.service";
import { AgentsService } from "../src/modules/agents/agents.service";
import { AgentRuntimeService } from "../src/modules/ai-buyer/agent-runtime.service";

const dbConfigured = Boolean(process.env.DATABASE_URL);
const rid = () => randomUUID().replace(/-/g, "").slice(0, 20);

test("recovery agent stages an opportunity for each abandoned cart with a known customer", { skip: !dbConfigured }, async () => {
  const db = getDb();
  const merchantId = `merchant_${rid()}`;
  await db.merchant.create({ data: { id: merchantId, name: "M", slug: `m-${rid()}` } });
  const customerId = `cust_${rid()}`;
  await db.customer.create({ data: { id: customerId, merchantId, email: "a@b.com" } });
  await db.cart.create({ data: { id: `cart_${rid()}`, merchantId, customerId, currency: "INR", status: "ABANDONED" } });
  // an abandoned cart with NO known customer must be ignored
  await db.cart.create({ data: { id: `cart_${rid()}`, merchantId, currency: "INR", status: "ABANDONED" } });

  const svc = new AgentsService(new DashboardService(), new AgentRuntimeService());
  const results = await svc.runAll(merchantId);

  assert.equal(results.recovery, 1);
  const ops = await db.growthOpportunity.findMany({ where: { merchantId, type: "CART_RECOVERY" } });
  assert.equal(ops.length, 1);
  assert.equal(ops[0]!.status, "OPEN");
  assert.equal(ops[0]!.severity, "MEDIUM");
});

test("growth agent flags a demand spike for a top-selling product", { skip: !dbConfigured }, async () => {
  const db = getDb();
  const merchantId = `merchant_${rid()}`;
  await db.merchant.create({ data: { id: merchantId, name: "M", slug: `m-${rid()}` } });
  const websiteId = `site_${rid()}`;
  await db.website.create({
    data: { id: websiteId, merchantId, publicKey: `pk_${rid()}`, url: "https://x.com", hostname: "x.com", status: "READY" },
  });
  const productId = `prod_${rid()}`;
  await db.product.create({
    data: { id: productId, merchantId, websiteId, name: "Shoe", priceMinor: 1000, currency: "INR", sourceUrl: `https://x.com/${rid()}` },
  });
  const orderId = `order_${rid()}`;
  await db.order.create({
    data: {
      id: orderId,
      merchantId,
      status: "PAID",
      subtotalMinor: 5000,
      totalMinor: 5000,
      currency: "INR",
      items: { create: { id: `oi_${rid()}`, productId, titleSnapshot: "Shoe", quantity: 5, unitPriceMinor: 1000 } },
    },
  });

  const svc = new AgentsService(new DashboardService(), new AgentRuntimeService());
  const results = await svc.runAll(merchantId);

  assert.ok(results.growth >= 1);
  const ops = await db.growthOpportunity.findMany({ where: { merchantId, type: "DEMAND_SPIKE" } });
  assert.equal(ops.length, 1);
  assert.equal(ops[0]!.refId, productId);
});

test("recovery agent skips carts whose customer has no contact info", { skip: !dbConfigured }, async () => {
  const db = getDb();
  const merchantId = `merchant_${rid()}`;
  await db.merchant.create({ data: { id: merchantId, name: "M", slug: `m-${rid()}` } });
  const noContact = `cust_${rid()}`;
  await db.customer.create({ data: { id: noContact, merchantId } }); // no email/phone
  await db.cart.create({ data: { id: `cart_${rid()}`, merchantId, customerId: noContact, currency: "INR", status: "ABANDONED" } });

  const reachable = `cust_${rid()}`;
  await db.customer.create({ data: { id: reachable, merchantId, email: "b@c.com" } });
  const reachableCart = `cart_${rid()}`;
  await db.cart.create({ data: { id: reachableCart, merchantId, customerId: reachable, currency: "INR", status: "ABANDONED" } });

  const svc = new AgentsService(new DashboardService(), new AgentRuntimeService());
  const results = await svc.run(merchantId, "recovery");

  assert.equal(results, 1);
  const ops = await db.growthOpportunity.findMany({ where: { merchantId, type: "CART_RECOVERY" } });
  assert.equal(ops.length, 1);
  assert.equal(ops[0]!.refId, reachableCart);
});

test("insights agent flags an abandoned-cart backlog", { skip: !dbConfigured }, async () => {
  const db = getDb();
  const merchantId = `merchant_${rid()}`;
  await db.merchant.create({ data: { id: merchantId, name: "M", slug: `m-${rid()}` } });
  const websiteId = `site_${rid()}`;
  await db.website.create({
    data: { id: websiteId, merchantId, publicKey: `pk_${rid()}`, url: "https://x.com", hostname: "x.com", status: "READY" },
  });
  const productId = `prod_${rid()}`;
  await db.product.create({
    data: { id: productId, merchantId, websiteId, name: "Shoe", priceMinor: 1000, currency: "INR", sourceUrl: `https://x.com/${rid()}` },
  });
  const cust = `cust_${rid()}`;
  await db.customer.create({ data: { id: cust, merchantId, email: "c@d.com" } });
  await db.cart.create({
    data: { id: `cart_${rid()}`, merchantId, customerId: cust, currency: "INR", status: "ABANDONED", items: { create: { id: `ci_${rid()}`, productId, quantity: 1, unitPriceMinor: 1000 } } },
  });

  const svc = new AgentsService(new DashboardService(), new AgentRuntimeService());
  const results = await svc.run(merchantId, "insights");

  assert.ok(results >= 1);
  const ops = await db.growthOpportunity.findMany({ where: { merchantId, type: "ABANDONED_CART_BACKLOG" } });
  assert.equal(ops.length, 1);
});
