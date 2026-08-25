import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiClient, ApiError } from "../src/index.ts";

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("unwraps the {ok:true,data} envelope", async () => {
  globalThis.fetch = async () => ok({ ok: true, data: { accessToken: "t", expiresIn: 900 } });
  const client = new ApiClient({ baseUrl: "http://api.test" });
  const result = await client.auth.login("a@b.c", "pw");
  assert.equal(result.accessToken, "t");
});

test("throws ApiError with envelope code on failure", async () => {
  globalThis.fetch = async () => ok({ ok: false, error: { code: "INVALID_CREDENTIALS", message: "nope" } }, 401);
  const client = new ApiClient({ baseUrl: "http://api.test" });
  await assert.rejects(client.auth.login("a@b.c", "bad"), (err: ApiError) => {
    assert.equal(err.status, 401);
    assert.equal(err.code, "INVALID_CREDENTIALS");
    return true;
  });
});

test("sends bearer token from getToken when auth is required", async () => {
  let seen: string | undefined;
  // @ts-expect-error minimal fetch stub
  globalThis.fetch = async (_url: string, init?: RequestInit) => {
    seen = (init?.headers as Record<string, string>).authorization;
    return ok({ ok: true, data: [] });
  };
  const client = new ApiClient({ baseUrl: "http://api.test", getToken: () => "tok123" });
  await client.merchants.listMine();
  assert.equal(seen, "Bearer tok123");
});
