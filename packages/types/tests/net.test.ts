import assert from "node:assert/strict";
import { test } from "node:test";
import { assertPublicUrl, ssrfSafeFetch, validateResolvedAddresses } from "../src/net.ts";

test("rejects non-http schemes", async () => {
  await assert.rejects(assertPublicUrl("ftp://example.com"), /only http/);
});

test("rejects internal hostnames without DNS", async () => {
  await assert.rejects(assertPublicUrl("http://localhost/x"), /blocked hostname/);
  await assert.rejects(assertPublicUrl("http://db.internal.corp/x"), /blocked hostname/);
});

test("rejects private and reserved IPv4", () => {
  for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.9", "169.254.169.254", "0.0.0.0"]) {
    assert.throws(() => validateResolvedAddresses([{ address: ip, family: 4 } as never]), new RegExp(ip));
  }
  validateResolvedAddresses([{ address: "93.184.216.34", family: 4 } as never]); // public passes
});

test("rejects loopback and IPv4-mapped private IPv6", () => {
  assert.throws(() => validateResolvedAddresses([{ address: "::1", family: 6 } as never]));
  assert.throws(() => validateResolvedAddresses([{ address: "::ffff:127.0.0.1", family: 6 } as never]));
  assert.throws(() => validateResolvedAddresses([{ address: "fd00::1", family: 6 } as never]));
});

test("public hostname resolves and passes", async () => {
  const url = await assertPublicUrl("https://example.com/");
  assert.equal(url.hostname, "example.com");
});

test("ssrfSafeFetch blocks a rebinding-style private target at connection level", async () => {
  await assert.rejects(ssrfSafeFetch("http://127.0.0.1:4000/health/live"), /blocked|private/i);
});
