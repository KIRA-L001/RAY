import assert from "node:assert/strict";
import "reflect-metadata";
import { test } from "node:test";
import { config as loadEnv } from "dotenv";
loadEnv({ path: "../../.env" });
import { randomUUID } from "node:crypto";
import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { getDb } from "@ray/database";
import { TenantAccessGuard } from "../src/common/tenancy/tenant.guard";
import { AppException } from "../src/common/errors/app.exception";

const dbConfigured = Boolean(process.env.DATABASE_URL);
const rid = () => randomUUID().replace(/-/g, "").slice(0, 20);

function makeCtx(merchantId: string, userId: string) {
  const req: Record<string, unknown> = { params: { merchantId }, user: { sub: userId } };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
  } as unknown as ExecutionContext;
}

// Tenant isolation is enforced by TenantAccessGuard: a request is only allowed
// if the authenticated user has a Membership for the :merchantId in the route.
test("tenant isolation: member allowed own merchant; non-member denied", { skip: !dbConfigured }, async () => {
  const db = getDb();
  const merchantA = `m_${rid()}`;
  const merchantB = `m_${rid()}`;
  const user = `u_${rid()}`;
  await db.merchant.create({ data: { id: merchantA, name: "A", slug: `a-${rid()}` } });
  await db.merchant.create({ data: { id: merchantB, name: "B", slug: `b-${rid()}` } });
  await db.user.create({ data: { id: user, email: `${user}@ex.com`, passwordHash: "x" } });
  await db.membership.create({ data: { id: `mem_${rid()}`, userId: user, merchantId: merchantA, role: "OWNER" } });

  const guard = new TenantAccessGuard(new Reflector());

  // member of A can access A
  const ok = await guard.canActivate(makeCtx(merchantA, user));
  assert.equal(ok, true);

  // not a member of B -> denied with same 403 (no probing of existence)
  try {
    await guard.canActivate(makeCtx(merchantB, user));
    assert.fail("expected FORBIDDEN");
  } catch (e) {
    assert.equal((e as AppException).status, 403);
    assert.equal((e as AppException).code, "FORBIDDEN");
  }
});

test("tenant isolation: a user with no memberships is denied for any merchant", { skip: !dbConfigured }, async () => {
  const db = getDb();
  const merchantA = `m_${rid()}`;
  const outsider = `u_${rid()}`;
  await db.merchant.create({ data: { id: merchantA, name: "A", slug: `a-${rid()}` } });
  await db.user.create({ data: { id: outsider, email: `${outsider}@ex.com`, passwordHash: "x" } });

  const guard = new TenantAccessGuard(new Reflector());
  try {
    await guard.canActivate(makeCtx(merchantA, outsider));
    assert.fail("expected FORBIDDEN");
  } catch (e) {
    assert.equal((e as AppException).status, 403);
    assert.equal((e as AppException).code, "FORBIDDEN");
  }
});
