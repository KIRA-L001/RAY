import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyOutcome, backoffMs, MAX_ATTEMPTS } from "../src/modules/notifications/recovery";

test("a successful send is marked SENT", () => {
  assert.deepEqual(classifyOutcome({ ok: true }, 1), { outcome: "SENT" });
});

test("early failed attempts are RETRY with exponential backoff", () => {
  assert.deepEqual(classifyOutcome({ ok: false }, 1), { outcome: "RETRY", retryAfterMs: 1000 });
  assert.deepEqual(classifyOutcome({ ok: false }, 2), { outcome: "RETRY", retryAfterMs: 2000 });
});

test("a failed attempt at the cap is marked FAILED", () => {
  assert.deepEqual(classifyOutcome({ ok: false }, MAX_ATTEMPTS), { outcome: "FAILED" });
  assert.deepEqual(classifyOutcome({ ok: false }, MAX_ATTEMPTS + 5), { outcome: "FAILED" });
});

test("backoff is capped at 60s", () => {
  assert.equal(backoffMs(7), 60_000);
});
