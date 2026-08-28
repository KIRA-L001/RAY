import assert from "node:assert/strict";
import "reflect-metadata";
import { test } from "node:test";
import { config as loadEnv } from "dotenv";
loadEnv({ path: "../../.env" });
import { randomUUID } from "node:crypto";
import { Reflector } from "@nestjs/core";
import { ExecutionContext } from "@nestjs/common";
import { getDb } from "@ray/database";
import { TenantAccessGuard, MIN_MERCHANT_ROLE_KEY, type MerchantRoleName } from "../src/common/tenancy/tenant.guard";
import { AppException } from "../src/common/errors/app.exception";

const dbConfigured = Boolean(process.env.DATABASE_URL);
const rid = () => randomUUID().replace(/-/g, "").slice(0, 20);

function makeCtx(merchantId: string, userId: string, minRole?: MerchantRoleName) {
  const handler: Record<string, unknown> = {};
  if (minRole) Reflect.defineMetadata(MIN_MERCHANT_ROLE_KEY, minRole, handler);
  const req: Record<string, unknown> = { params: { merchantId }, user: { sub: userId } };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
  } as unknown as ExecutionContext;
}

async function seed(role: MerchantRoleName) {
  const db = getDb();
  const merchantId = `m_${rid()}`;
  const userId = `u_${rid()}`;
  await db.merchant.create({ data: { id: merchantId, name: "M", slug: `s-${rid()}` } });
  await db.user.create({ data: { id: userId, email: `${userId}@ex.com`, passwordHash: "x" } });
  await db.membership.create({ data: { id: `mem_${rid()}`, userId, merchantId, role } });
  return { merchantId, userId };
}

test("authorization: VIEWER is denied an ADMIN-guarded route", { skip: !dbConfigured }, async () => {
  const { merchantId, userId } = await seed("VIEWER");
  const guard = new TenantAccessGuard(new Reflector());
  try {
    await guard.canActivate(makeCtx(merchantId, userId, "ADMIN"));
    assert.fail("expected FORBIDDEN");
  } catch (e) {
    assert.equal((e as AppException).status, 403);
    assert.equal((e as AppException).code, "FORBIDDEN");
  }
});

test("authorization: OWNER passes an ADMIN-guarded route", { skip: !dbConfigured }, async () => {
  const { merchantId, userId } = await seed("OWNER");
  const guard = new TenantAccessGuard(new Reflector());
  const ok = await guard.canActivate(makeCtx(merchantId, userId, "ADMIN"));
  assert.equal(ok, true);
});

test("authorization: MANAGER passes MANAGER but is denied OWNER", { skip: !dbConfigured }, async () => {
  const { merchantId, userId } = await seed("MANAGER");
  const guard = new TenantAccessGuard(new Reflector());
  assert.equal(await guard.canActivate(makeCtx(merchantId, userId, "MANAGER")), true);
  try {
    await guard.canActivate(makeCtx(merchantId, userId, "OWNER"));
    assert.fail("expected FORBIDDEN");
  } catch (e) {
    assert.equal((e as AppException).status, 403);
  }
});

test("authorization: default (no role metadata) allows VIEWER", { skip: !dbConfigured }, async () => {
  const { merchantId, userId } = await seed("VIEWER");
  const guard = new TenantAccessGuard(new Reflector());
  assert.equal(await guard.canActivate(makeCtx(merchantId, userId)), true);
});
