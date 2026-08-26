import assert from "node:assert/strict";
import { test } from "node:test";
import { createRay } from "../src/index.ts";
import type { EventEnvelope } from "@ray/types";

class MemStorage {
  #map = new Map<string, string>();
  getItem(k: string) {
    return this.#map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.#map.set(k, String(v));
  }
}

function fakeFetch() {
  const calls: Array<{ url: string; auth?: string; body: EventEnvelope[] }> = [];
  const impl = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      auth: new Headers(init?.headers).get("authorization") ?? undefined,
      body: JSON.parse(String(init?.body)) as EventEnvelope[],
    });
    return Promise.resolve(new Response(null, { status: 202 }));
  }) as typeof fetch;
  return { impl, calls };
}

const config = {
  endpoint: "https://api.ray.test",
  siteKey: "sitekey_test",
  sessionId: "sess_1",
  anonymousId: "anon_1",
};

test("queues events and flushes as a batch to /v1/events", () => {
  const { impl, calls } = fakeFetch();
  const ray = createRay({ ...config, fetchImpl: impl });
  ray.track("page_view", { path: "/" });
  ray.flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://api.ray.test/v1/events");
  const [evt] = calls[0]!.body;
  assert.equal(evt!.eventType, "page_view");
  assert.ok(calls[0]!.auth?.startsWith("Bearer sitekey_"), "site key sent as bearer");
  assert.equal(evt!.sessionId, "sess_1");
  assert.equal(evt!.anonymousId, "anon_1");
  assert.equal(evt!.merchantId, null);
  assert.equal(evt!.source, "sdk");
  assert.equal(evt!.schemaVersion, 1);
});

test("auto-flushes when the queue reaches flushAt", () => {
  const { impl, calls } = fakeFetch();
  const ray = createRay({ ...config, fetchImpl: impl, flushAt: 3 });
  ray.track("page_view");
  ray.track("search", { query: "shoes" });
  assert.equal(calls.length, 0);
  ray.track("page_view");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.body.length, 3);
});

test("identify emits customer_identified with supplied props", () => {
  const { impl, calls } = fakeFetch();
  const ray = createRay({ ...config, fetchImpl: impl });
  ray.identify({ customerId: "cust_9", email: "a@b.c" });
  ray.flush();
  const evt = calls[0]!.body[0]!;
  assert.equal(evt.eventType, "customer_identified");
  assert.deepEqual(evt.data, { customerId: "cust_9", email: "a@b.c" });
});

test("network failure never throws into the merchant page", () => {
  const failing = (() => Promise.reject(new Error("down"))) as typeof fetch;
  const ray = createRay({ ...config, fetchImpl: failing });
  ray.track("page_view");
  ray.flush();
});

function withStorages(local: Storage | undefined, session: Storage | undefined, fn: () => void) {
  const g = globalThis as { localStorage?: Storage; sessionStorage?: Storage };
  const { localStorage: l, sessionStorage: s } = g;
  if (local === undefined) delete g.localStorage;
  else g.localStorage = local;
  if (session === undefined) delete g.sessionStorage;
  else g.sessionStorage = session;
  try {
    fn();
  } finally {
    if (l === undefined) delete g.localStorage;
    else g.localStorage = l;
    if (s === undefined) delete g.sessionStorage;
    else g.sessionStorage = s;
  }
}

const noopFetch = (() => Promise.resolve(new Response())) as typeof fetch;
const bare = { endpoint: config.endpoint, siteKey: config.siteKey };

test("anonymousId persists across instances via storage", () => {
  withStorages(new MemStorage() as unknown as Storage, new MemStorage() as unknown as Storage, () => {
    const a = createRay({ ...bare, fetchImpl: noopFetch, flushAt: 100 });
    const b = createRay({ ...bare, fetchImpl: noopFetch, flushAt: 100 });
    assert.equal(b.anonymousId(), a.anonymousId());
    assert.equal(b.sessionId(), a.sessionId());
  });
});

test("sessionId rotates when the stored session record is older than the timeout", () => {
  const session = new MemStorage();
  withStorages(new MemStorage() as unknown as Storage, session as unknown as Storage, () => {
    const ray = createRay({ ...bare, fetchImpl: noopFetch, flushAt: 100 });
    const before = ray.sessionId();
    assert.ok(session.getItem("ray:sess"), "session record written at init");
    const raw = session.getItem("ray:sess")!;
    const record = JSON.parse(raw) as { v: string; t: number };
    session.setItem("ray:sess", JSON.stringify({ v: record.v, t: record.t - 31 * 60 * 1000 }));
    assert.notEqual(ray.sessionId(), before);
  });
});

test("blocked storage falls back to generated ids without throwing", () => {
  withStorages(undefined, undefined, () => {
    let id = "";
    assert.doesNotThrow(() => {
      const ray = createRay({ ...config, fetchImpl: noopFetch, flushAt: 1 });
      id = ray.anonymousId();
      ray.track("page_view");
    });
    assert.ok(id.length > 0);
  });
});
