import assert from "node:assert/strict";
import "reflect-metadata";
import { test } from "node:test";
import { ExecutionContext } from "@nestjs/common";
import { signJwt, verifyJwt } from "../src/common/auth/jwt";
import { JwtAuthGuard } from "../src/common/auth/jwt-auth.guard";
import { AppException } from "../src/common/errors/app.exception";

const SECRET = "test-secret-not-change-me";
process.env.JWT_SECRET = SECRET;

function makeCtx(headers: Record<string, string>): ExecutionContext {
  const req: Record<string, unknown> = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

test("verifyJwt accepts a well-formed token and returns the payload", () => {
  const token = signJwt({ sub: "u1", email: "a@b.com" }, SECRET, 60);
  const payload = verifyJwt(token, SECRET);
  assert.equal(payload?.sub, "u1");
});

test("verifyJwt rejects a tampered signature", () => {
  const token = signJwt({ sub: "u1", email: "a@b.com" }, SECRET, 60);
  const parts = token.split(".");
  const tampered = `${parts[0]}.${parts[1]}.${parts[2]?.slice(0, -1)}x`;
  assert.equal(verifyJwt(tampered, SECRET), null);
});

test("verifyJwt rejects a token signed with a different secret", () => {
  const token = signJwt({ sub: "u1", email: "a@b.com" }, SECRET, 60);
  assert.equal(verifyJwt(token, "other-secret"), null);
});

test("verifyJwt rejects an expired token", () => {
  const token = signJwt({ sub: "u1", email: "a@b.com" }, SECRET, -10);
  assert.equal(verifyJwt(token, SECRET), null);
});

test("verifyJwt rejects malformed tokens", () => {
  assert.equal(verifyJwt("only.two", SECRET), null);
  assert.equal(verifyJwt("garbage", SECRET), null);
  assert.equal(verifyJwt("", SECRET), null);
});

test("JwtAuthGuard rejects a missing Authorization header with 401", () => {
  const guard = new JwtAuthGuard();
  try {
    guard.canActivate(makeCtx({}));
    assert.fail("expected UNAUTHORIZED");
  } catch (e) {
    assert.equal((e as AppException).status, 401);
    assert.equal((e as AppException).code, "UNAUTHORIZED");
  }
});

test("JwtAuthGuard rejects an invalid token with 401", () => {
  const guard = new JwtAuthGuard();
  try {
    guard.canActivate(makeCtx({ authorization: "Bearer not-a-real-token" }));
    assert.fail("expected UNAUTHORIZED");
  } catch (e) {
    assert.equal((e as AppException).status, 401);
  }
});

test("JwtAuthGuard accepts a valid Bearer token and sets request.user", () => {
  const guard = new JwtAuthGuard();
  const token = signJwt({ sub: "u1", email: "a@b.com" }, SECRET, 60);
  const req: Record<string, unknown> = { headers: { authorization: `Bearer ${token}` } };
  const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
  assert.equal(guard.canActivate(ctx), true);
  assert.equal((req.user as { sub: string }).sub, "u1");
});
