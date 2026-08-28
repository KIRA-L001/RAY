import assert from "node:assert/strict";
import { test } from "node:test";
import { redactSensitive } from "../src/common/security/redact";

test("redactSensitive masks secret and PII keys", () => {
  const out = redactSensitive({
    email: "a@b.com",
    phone: "1234567890",
    password: "hunter2",
    token: "abc.def.ghi",
    name: "Product X",
    nested: { mobile: "9988776655" },
    list: [{ email: "c@d.com" }],
  }) as Record<string, unknown>;
  const nested = out.nested as Record<string, unknown>;
  const list0 = (out.list as unknown[])[0] as Record<string, unknown>;
  assert.equal(out.email, "a@***om");
  assert.equal(out.phone, "12***90");
  assert.equal(out.password, "[REDACTED]");
  assert.equal(out.token, "[REDACTED]");
  assert.equal(out.name, "Product X", "non-PII 'name' is preserved");
  assert.equal(nested.mobile, "99***55");
  assert.equal(list0.email, "c@***om");
});

test("redactSensitive leaves scalars and unknown keys untouched", () => {
  const out = redactSensitive({ count: 3, ok: true, label: "open" });
  assert.deepEqual(out, { count: 3, ok: true, label: "open" });
});
