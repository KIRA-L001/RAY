import assert from "node:assert/strict";
import { test } from "node:test";
import { processNotification, type ProcessDeps, type SaveRow } from "../src/modules/notifications/notification.queue";

function fakeDeps(over: Partial<ProcessDeps> = {}) {
  const saves: SaveRow[] = [];
  const attempts: Record<string, number> = {};
  const deps: ProcessDeps = {
    send: over.send ?? (async () => ({ ok: true, externalId: "ext" })),
    resolveChannelId: over.resolveChannelId ?? (async () => "ch1"),
    save: over.save ?? (async (row) => {
      saves.push(row);
      attempts[row.idempotencyKey] = (attempts[row.idempotencyKey] ?? 0) + 1;
      return attempts[row.idempotencyKey] ?? 0;
    }),
  };
  return { deps, saves };
}

const data = {
  idempotencyKey: "key1",
  merchantId: "m1",
  channelType: "WHATSAPP",
  to: "+919999",
  body: "hi",
  purpose: "order_update",
  customerId: "c1",
};

test("marks FAILED when no channel is configured", async () => {
  const { deps, saves } = fakeDeps({ resolveChannelId: async () => null });
  const r = await processNotification(data, deps);
  assert.equal(r, "done");
  assert.equal(saves.at(-1)?.status, "FAILED");
  assert.equal(saves.at(-1)?.channelId, null);
});

test("marks SENT on a successful send", async () => {
  const { deps, saves } = fakeDeps();
  const r = await processNotification(data, deps);
  assert.equal(r, "done");
  assert.equal(saves.at(-1)?.status, "SENT");
  assert.equal(saves.at(-1)?.externalId, "ext");
});

test("returns retry on an early failure", async () => {
  const { deps, saves } = fakeDeps({ send: async () => ({ ok: false, error: "boom" }) });
  const r = await processNotification(data, deps);
  assert.equal(r, "retry");
  assert.equal(saves.at(-1)?.status, "QUEUED");
});

test("marks FAILED after the retry cap is exhausted", async () => {
  const attempts: Record<string, number> = { key1: 2 };
  const saves: SaveRow[] = [];
  const deps: ProcessDeps = {
    send: async () => ({ ok: false, error: "boom" }),
    resolveChannelId: async () => "ch1",
    save: async (row) => {
      saves.push(row);
      attempts[row.idempotencyKey] = (attempts[row.idempotencyKey] ?? 0) + 1;
      return attempts[row.idempotencyKey] ?? 0;
    },
  };
  const r = await processNotification(data, deps);
  assert.equal(r, "done");
  assert.equal(saves.at(-1)?.status, "FAILED");
});
