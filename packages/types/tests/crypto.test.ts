import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, newId, verifyPassword } from "../src/crypto.ts";

test("password hash round-trips and rejects wrong passwords", () => {
  const stored = hashPassword("hunter2");
  assert.match(stored, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.equal(verifyPassword("hunter2", stored), true);
  assert.equal(verifyPassword("wrong", stored), false);
  assert.equal(verifyPassword("hunter2", "garbage"), false);
});

test("hashes are salted per call", () => {
  assert.notEqual(hashPassword("x"), hashPassword("x"));
});

test("newId produces prefixed ids", () => {
  const id = newId("merchant");
  assert.match(id, /^merchant_[0-9a-f-]{36}$/);
});
