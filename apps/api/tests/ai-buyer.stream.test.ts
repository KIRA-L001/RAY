import assert from "node:assert/strict";
import "reflect-metadata";
import { test } from "node:test";
import { config as loadEnv } from "dotenv";
loadEnv({ path: "../../.env" });
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { getDb } from "@ray/database";
import { AppModule } from "../src/app.module";

function parseNdjson(body: string): Array<Record<string, unknown>> {
  return body
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

// Skips when no database is configured so local `pnpm test` without infra stays green.
const dbConfigured = Boolean(process.env.DATABASE_URL);

test("buyer chat stream resolves merchant from siteKey, persists messages, streams NDJSON", { skip: !dbConfigured }, async () => {
  const db = getDb();
  const merchant = await db.merchant.create({
    data: { id: `merchant_${randomUUID().replace(/-/g, "").slice(0, 20)}`, name: "Test Merchant", slug: `test-${randomUUID().slice(0, 8)}` },
  });
  const siteKey = `sitekey_${randomUUID()}`;
  const website = await db.website.create({
    data: {
      id: `site_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
      merchantId: merchant.id,
      publicKey: siteKey,
      url: "https://example.com",
      hostname: "example.com",
      status: "READY",
    },
  });

  const app = await NestFactory.create(AppModule, new FastifyAdapter());
  await app.init();
  try {
    const res = await (app.getHttpAdapter().getInstance() as import("fastify").FastifyInstance).inject({
      method: "POST",
      url: "/v1/buyer/chat/stream",
      payload: { siteKey, message: "I want red shoes" },
    });

    assert.equal(res.statusCode, 200, res.body);
    const events = parseNdjson(res.body);
    const deltas = events.filter((e) => e.type === "delta");
    const done = events.find((e) => e.type === "done");
    assert.ok(deltas.length > 0, "expected at least one delta");
    assert.ok(done, "expected a done event");
    assert.equal(typeof (done as { conversationId?: string }).conversationId, "string");

    const convId = (done as { conversationId: string }).conversationId;
    const conv = await db.conversation.findUnique({ where: { id: convId } });
    assert.equal(conv?.merchantId, merchant.id, "conversation must belong to resolved merchant");

    const messages = await db.conversationMessage.findMany({ where: { conversationId: convId }, orderBy: { createdAt: "asc" } });
    assert.equal(messages.length, 2);
    assert.equal(messages[0]!.role, "USER");
    assert.equal(messages[0]!.content, "I want red shoes");
    assert.equal(messages[1]!.role, "ASSISTANT");
    assert.ok((messages[1]!.content as string).includes("RAY"));
  } finally {
    await app.close();
    await db.agentRun.deleteMany({ where: { merchantId: merchant.id } });
    await db.conversationMessage.deleteMany({ where: { conversationId: { startsWith: "conv_" } } });
    await db.conversation.deleteMany({ where: { merchantId: merchant.id } });
    await db.website.deleteMany({ where: { id: website.id } });
    await db.merchant.deleteMany({ where: { id: merchant.id } });
  }
});

test("buyer chat rejects a conversationId that belongs to another merchant", { skip: !dbConfigured }, async () => {
  const db = getDb();
  const m1 = await db.merchant.create({ data: { id: `merchant_${randomUUID().slice(0, 20)}`, name: "M1", slug: `m1-${randomUUID().slice(0, 8)}` } });
  const m2 = await db.merchant.create({ data: { id: `merchant_${randomUUID().slice(0, 20)}`, name: "M2", slug: `m2-${randomUUID().slice(0, 8)}` } });
  const w2 = await db.website.create({
    data: { id: `site_${randomUUID().slice(0, 20)}`, merchantId: m2.id, publicKey: `sitekey_${randomUUID()}`, url: "https://x.com", hostname: "x.com", status: "READY" },
  });
  const otherConv = await db.conversation.create({ data: { id: `conv_${randomUUID().slice(0, 20)}`, merchantId: m1.id, channel: "BUYER" } });

  const app = await NestFactory.create(AppModule, new FastifyAdapter());
  await app.init();
  try {
    const res = await (app.getHttpAdapter().getInstance() as import("fastify").FastifyInstance).inject({
      method: "POST",
      url: "/v1/buyer/chat/stream",
      payload: { siteKey: w2.publicKey, message: "hi", conversationId: otherConv.id },
    });
    assert.equal(res.statusCode, 404);
    assert.equal(JSON.parse(res.body).error.code, "CONVERSATION_NOT_FOUND");
  } finally {
    await app.close();
    await db.conversation.deleteMany({ where: { id: otherConv.id } });
    await db.website.deleteMany({ where: { id: w2.id } });
    await db.merchant.deleteMany({ where: { id: m1.id } });
    await db.merchant.deleteMany({ where: { id: m2.id } });
  }
});
