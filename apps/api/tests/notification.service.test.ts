import assert from "node:assert/strict";
import { test } from "node:test";
import { NotificationService, type NotificationProvider } from "../src/modules/notifications/notification.service";
import { encryptJson } from "../src/modules/notifications/crypto";

function fakeProvider(channelType: string, onSend?: (i: { to: string; config: Record<string, unknown> }) => void): NotificationProvider {
  return {
    channelType,
    async send(input) {
      onSend?.(input);
      return { ok: true, externalId: "ext-1" };
    },
  };
}

function channel(status: string) {
  return { id: "ch1", status, encryptedConfig: encryptJson({ token: "secret", phoneId: "123" }) };
}

test("send decrypts channel config and dispatches to the registered provider", async () => {
  let seen: { to: string; config: Record<string, unknown> } | undefined;
  const svc = new NotificationService(async () => channel("CONNECTED"));
  svc.register(fakeProvider("WHATSAPP", (i) => (seen = i)));
  const res = await svc.send({ merchantId: "m1", channelType: "WHATSAPP", to: "+919999", body: "hi" });

  assert.equal(res.ok, true);
  assert.equal(res.externalId, "ext-1");
  assert.equal(seen?.to, "+919999");
  assert.deepEqual(seen?.config, { token: "secret", phoneId: "123" });
});

test("send returns channel_not_found when no channel exists", async () => {
  const svc = new NotificationService(async () => null);
  svc.register(fakeProvider("WHATSAPP"));
  const res = await svc.send({ merchantId: "m1", channelType: "WHATSAPP", to: "+919999", body: "hi" });
  assert.equal(res.ok, false);
  assert.equal(res.error, "channel_not_found");
});

test("send returns channel_not_connected for a disconnected channel", async () => {
  const svc = new NotificationService(async () => channel("DISCONNECTED"));
  svc.register(fakeProvider("WHATSAPP"));
  const res = await svc.send({ merchantId: "m1", channelType: "WHATSAPP", to: "+919999", body: "hi" });
  assert.equal(res.ok, false);
  assert.equal(res.error, "channel_not_connected");
});

test("send returns no_provider when no provider is registered for the type", async () => {
  const svc = new NotificationService(async () => channel("CONNECTED"));
  const res = await svc.send({ merchantId: "m1", channelType: "WHATSAPP", to: "+919999", body: "hi" });
  assert.equal(res.ok, false);
  assert.equal(res.error, "no_provider");
});

test("send blocks when the customer has not opted in", async () => {
  let called = false;
  const svc = new NotificationService(
    async () => channel("CONNECTED"),
    async () => false,
  );
  svc.register(fakeProvider("WHATSAPP", () => (called = true)));
  const res = await svc.send({ merchantId: "m1", channelType: "WHATSAPP", to: "+919999", body: "hi", customerId: "c1" });
  assert.equal(res.ok, false);
  assert.equal(res.error, "consent_required");
  assert.equal(called, false);
});

test("send proceeds when the customer has opted in", async () => {
  let seen: { to: string; config: Record<string, unknown> } | undefined;
  const svc = new NotificationService(
    async () => channel("CONNECTED"),
    async () => true,
  );
  svc.register(fakeProvider("WHATSAPP", (i) => (seen = i)));
  const res = await svc.send({ merchantId: "m1", channelType: "WHATSAPP", to: "+919999", body: "hi", customerId: "c1" });
  assert.equal(res.ok, true);
  assert.equal(seen?.to, "+919999");
});
