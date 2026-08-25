import assert from "node:assert/strict";
import { test } from "node:test";
import { isId, money } from "../src/index.ts";

test("money rejects fractional and negative amounts", () => {
  assert.deepEqual(money(449900, "INR"), { amountMinor: 449900, currency: "INR" });
  assert.throws(() => money(44.99, "INR"));
  assert.throws(() => money(-1, "INR"));
});

test("isId validates prefixed opaque ids", () => {
  assert.equal(isId("merchant_01JABC", "merchant"), true);
  assert.equal(isId("order_01JABC", "merchant"), false);
  assert.equal(isId(123 as unknown, "user"), false);
});
