import assert from "node:assert/strict";
import { test } from "node:test";
import { createRay } from "../src/index.ts";
import type { EventEnvelope } from "@ray/types";

function fakeFetch() {
  const calls: Array<{ url: string; body: EventEnvelope[] }> = [];
  const impl = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as EventEnvelope[] });
    return Promise.resolve(new Response(null, { status: 202 }));
  }) as typeof fetch;
  return { impl, calls };
}

const config = {
  endpoint: "https://api.ray.test",
  websiteId: "site_test",
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
  assert.equal(evt!.websiteId, "site_test");
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
