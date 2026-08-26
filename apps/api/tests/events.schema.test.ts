import assert from "node:assert/strict";
import { test } from "node:test";
import type { EventEnvelope } from "@ray/types";
import { eventBatchSchema, eventEnvelopeSchema } from "../src/modules/events/events.schema.ts";

function validEvent(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    eventId: "evt_123",
    eventType: "page_view",
    merchantId: null,
    websiteId: "site_abc",
    sessionId: "sess_1",
    customerId: null,
    anonymousId: "anon_1",
    timestamp: new Date().toISOString(),
    source: "sdk",
    schemaVersion: 1,
    data: {},
    ...overrides,
  };
}

test("accepts a canonical sdk envelope", () => {
  const parsed = eventEnvelopeSchema.parse(validEvent());
  assert.equal(parsed.eventType, "page_view");
});

test("rejects unknown event types", () => {
  assert.throws(() => eventEnvelopeSchema.parse(validEvent({ eventType: "payment_paid" as never })));
});

test("rejects client-supplied merchant identity and wrong id prefixes", () => {
  assert.throws(() => eventEnvelopeSchema.parse(validEvent({ merchantId: "merchant_x" as never })));
  assert.throws(() => eventEnvelopeSchema.parse(validEvent({ eventId: "not-prefixed" })));
  assert.throws(() => eventEnvelopeSchema.parse(validEvent({ sessionId: "abc" })));
  assert.throws(() => eventEnvelopeSchema.parse(validEvent({ anonymousId: "cust_9" })));
});

test("rejects wrong source, schemaVersion or timestamp", () => {
  assert.throws(() => eventEnvelopeSchema.parse(validEvent({ source: "browser" as never })));
  assert.throws(() => eventEnvelopeSchema.parse(validEvent({ schemaVersion: 2 as never })));
  assert.throws(() => eventEnvelopeSchema.parse(validEvent({ timestamp: "yesterday" })));
});

test("batch rejects empty and oversized payloads", () => {
  assert.throws(() => eventBatchSchema.parse([]));
  assert.throws(() => eventBatchSchema.parse(Array.from({ length: 101 }, () => validEvent())));
});
