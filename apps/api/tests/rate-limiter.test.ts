import assert from "node:assert/strict";
import { test } from "node:test";
import { createInMemoryRateLimiter } from "../src/common/security/rate-limiter";

test("rate limiter allows up to max then blocks, and resets after the window", async () => {
  const limiter = createInMemoryRateLimiter(2, 10);
  assert.equal(limiter("k"), true);
  assert.equal(limiter("k"), true);
  assert.equal(limiter("k"), false, "third hit in the window is blocked");
  assert.equal(limiter("other"), true, "a different key has its own budget");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(limiter("k"), true, "window elapsed, budget refilled");
});
