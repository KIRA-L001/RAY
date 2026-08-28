import assert from "node:assert/strict";
import { test } from "node:test";
import { WhatsAppProvider } from "../src/modules/notifications/whatsapp.provider";
import { NotificationService } from "../src/modules/notifications/notification.service";
import { encryptJson } from "../src/modules/notifications/crypto";

type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> };

function fakeFetchOnce(payload: unknown, status = 200): { fn: typeof fetch; captured: { url?: string; init?: RequestInit } } {
  const captured: { url?: string; init?: RequestInit } = {};
  const fn = (async (url: string, init?: RequestInit) => {
    captured.url = url;
    captured.init = init;
    return { ok: status < 400, status, json: async () => payload, text: async () => JSON.stringify(payload) } as FakeResponse;
  }) as typeof fetch;
  return { fn, captured };
}

test("WhatsApp provider posts to Graph API and returns the message id", async () => {
  const { fn, captured } = fakeFetchOnce({ messages: [{ id: "wamid.abc" }] });
  const p = new WhatsAppProvider(fn);
  const res = await p.send({ to: "+919999", body: "hi", config: { token: "t", phoneNumberId: "pid" } });

  assert.equal(res.ok, true);
  assert.equal(res.externalId, "wamid.abc");
  assert.match(captured.url ?? "", /graph\.facebook\.com\/v21\.0\/pid\/messages/);
  assert.equal((captured.init?.headers as Record<string, string>).Authorization, "Bearer t");
  assert.equal(JSON.parse(captured.init?.body as string).text.body, "hi");
});

test("WhatsApp provider returns a structured error on non-2xx", async () => {
  const { fn } = fakeFetchOnce({ error: { message: "bad token" } }, 401);
  const p = new WhatsAppProvider(fn);
  const res = await p.send({ to: "+919999", body: "hi", config: { token: "t", phoneNumberId: "pid" } });

  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /whatsapp_http_401/);
});

test("WhatsApp provider reports missing config", async () => {
  const { fn } = fakeFetchOnce({}, 200);
  const p = new WhatsAppProvider(fn);
  const res = await p.send({ to: "+919999", body: "hi", config: {} });
  assert.equal(res.ok, false);
  assert.equal(res.error, "whatsapp_config_missing");
});

test("registered WhatsApp provider dispatches through NotificationService", async () => {
  const { fn, captured } = fakeFetchOnce({ messages: [{ id: "wamid.svc" }] });
  const svc = new NotificationService(async () => ({
    id: "ch1",
    status: "CONNECTED",
    encryptedConfig: encryptJson({ token: "t", phoneNumberId: "pid" }),
  }));
  svc.register(new WhatsAppProvider(fn));

  const res = await svc.send({ merchantId: "m1", channelType: "WHATSAPP", to: "+919999", body: "hello" });
  assert.equal(res.ok, true);
  assert.equal(res.externalId, "wamid.svc");
  assert.match(captured.url ?? "", /pid\/messages/);
});
