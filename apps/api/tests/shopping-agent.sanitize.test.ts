import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeArgs } from "../src/modules/ai-buyer/shopping-agent.service";

test("rejects args that are not a plain object", () => {
  assert.throws(() => sanitizeArgs(null));
  assert.throws(() => sanitizeArgs([1, 2]));
  assert.throws(() => sanitizeArgs("nope"));
});

test("clamps numeric bounds", () => {
  assert.equal((sanitizeArgs({ limit: 9999 }) as { limit: number }).limit, 50);
  assert.equal((sanitizeArgs({ limit: 0 }) as { limit: number }).limit, 1);
  assert.equal((sanitizeArgs({ quantity: -5 }) as { quantity: number }).quantity, 0);
  assert.equal((sanitizeArgs({ quantity: 500 }) as { quantity: number }).quantity, 100);
});

test("truncates over-long strings", () => {
  const long = "x".repeat(2000);
  assert.equal((sanitizeArgs({ query: long }) as { query: string }).query.length, 500);
});

test("passes through scalars untouched when valid", () => {
  const out = sanitizeArgs({ productId: "p1", quantity: 2, note: "keep" });
  assert.deepEqual(out, { productId: "p1", quantity: 2, note: "keep" });
});
