import assert from "node:assert/strict";
import "reflect-metadata";
import { test } from "node:test";
import { config as loadEnv } from "dotenv";
loadEnv({ path: "../../.env" });
import { randomUUID } from "node:crypto";
import { getDb } from "@ray/database";
import { AgentRuntimeService } from "../src/modules/ai-buyer/agent-runtime.service";

const dbConfigured = Boolean(process.env.DATABASE_URL);
const rid = () => randomUUID().replace(/-/g, "").slice(0, 20);

test("agent runtime records a run lifecycle to agent_run", { skip: !dbConfigured }, async () => {
  const db = getDb();
  const merchantId = `merchant_${rid()}`;
  await db.merchant.create({ data: { id: merchantId, name: "M", slug: `m-${rid()}` } });

  const svc = new AgentRuntimeService();
  const runId = await svc.start("SHOPPING", { merchantId });

  try {
    const opened = await db.agentRun.findUnique({ where: { id: runId }, select: { status: true, agentType: true } });
    assert.equal(opened?.status, "RUNNING");
    assert.equal(opened?.agentType, "SHOPPING");

    await svc.finish(runId, "SUCCEEDED");

    const closed = await db.agentRun.findUnique({ where: { id: runId }, select: { status: true, completedAt: true } });
    assert.equal(closed?.status, "SUCCEEDED");
    assert.ok(closed?.completedAt instanceof Date);
  } finally {
    await db.agentRun.deleteMany({ where: { id: runId } });
    await db.merchant.deleteMany({ where: { id: merchantId } });
  }
});
