import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac } from "node:crypto";
import { config as loadEnv } from "dotenv";
loadEnv({ path: "../../.env" });
import { getDb } from "@ray/database";
import { extractStatuses, verifyMetaSignature, metaStatusToNotification } from "../src/modules/notifications/whatsapp-webhook";
import { encryptJson } from "../src/modules/notifications/crypto";
import { WhatsAppWebhookController } from "../src/modules/notifications/whatsapp-webhook.controller";

const dbConfigured = Boolean(process.env.DATABASE_URL);
const rid = () => Math.random().toString(36).slice(2, 10);

test("maps Meta statuses to notification statuses", () => {
  assert.equal(metaStatusToNotification("delivered"), "DELIVERED");
  assert.equal(metaStatusToNotification("read"), "READ");
  assert.equal(metaStatusToNotification("failed"), "FAILED");
  assert.equal(metaStatusToNotification("bogus"), null);
});

test("extractStatuses flattens nested payload", () => {
  const payload = {
    entry: [
      { changes: [{ value: { statuses: [{ id: "wamid.1", status: "delivered" }] } }] },
      { changes: [{ value: { statuses: [{ id: "wamid.2", status: "read" }] } }, { value: {} }] },
    ],
  };
  const out = extractStatuses(payload);
  assert.deepEqual(out, [
    { id: "wamid.1", status: "DELIVERED" },
    { id: "wamid.2", status: "READ" },
  ]);
});

test("verifyMetaSignature accepts a correct HMAC", () => {
  const secret = "appsecret";
  const body = Buffer.from('{"entry":[]}');
  const sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifyMetaSignature(body, secret, sig), true);
});

test("verifyMetaSignature rejects tampered body and bad prefix", () => {
  const secret = "appsecret";
  const body = Buffer.from("hello");
  const sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifyMetaSignature(Buffer.from("hello!"), secret, sig), false);
  assert.equal(verifyMetaSignature(body, secret, "sha1=" + sig.slice(6)), false);
});

test("webhook: a resent delivery is treated as a replay, not processed twice", { skip: !dbConfigured }, async () => {
  const db = getDb();
  const merchantId = `m_${rid()}`;
  const channelId = `ch_${rid()}`;
  const appSecret = "appsecret";
  await db.merchant.create({ data: { id: merchantId, name: "M", slug: `s-${rid()}` } });
  await db.notificationChannel.create({
    data: { id: channelId, merchantId, type: "WHATSAPP", encryptedConfig: encryptJson({ appSecret }) },
  });
  await db.notification.create({
    data: {
      id: `n_${rid()}`,
      merchantId,
      channelId,
      externalId: "wamid.replay",
      purpose: "ORDER_UPDATE",
      idempotencyKey: `idem_${rid()}`,
      status: "SENT",
      body: "hi",
      attempts: 0,
    },
  });

  const payload = { entry: [{ changes: [{ value: { statuses: [{ id: "wamid.replay", status: "delivered" }] } }] }] };
  const raw = Buffer.from(JSON.stringify(payload));
  const sig = "sha256=" + createHmac("sha256", appSecret).update(raw).digest("hex");
  const req = { rawBody: raw, body: payload } as unknown as Parameters<WhatsAppWebhookController["ingest"]>[1];

  const controller = new WhatsAppWebhookController();
  const first = await controller.ingest(channelId, req, sig);
  const second = await controller.ingest(channelId, req, sig);

  assert.equal(first.processed, 1);
  assert.equal(second.replayed, 1);
  assert.equal(second.processed, 0);
  const events = await db.webhookEvent.findMany({
    where: { provider: "whatsapp", externalEventId: "wamid.replay:DELIVERED", merchantId },
  });
  assert.equal(events.length, 1);
});
