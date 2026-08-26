import assert from "node:assert/strict";
import { test } from "node:test";
import { PolicyEngine } from "../src/modules/ai-buyer/policy-engine.service";

const engine = new PolicyEngine();

test("policy allows a discount within the configured max", async () => {
  const d = await engine.authorize("apply_discount", { discountPercent: 5 });
  assert.equal(d.allowed, true);
});

test("policy denies a discount above the configured max", async () => {
  const d = await engine.authorize("apply_discount", { discountPercent: 20 });
  assert.equal(d.allowed, false);
  assert.match(d.reason ?? "", /max 10%/);
});

test("policy allows tools that carry no discount", async () => {
  const d = await engine.authorize("search_products", { query: "shoes" });
  assert.equal(d.allowed, true);
});
