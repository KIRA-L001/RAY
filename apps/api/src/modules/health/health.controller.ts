import { Controller, Get, Res } from "@nestjs/common";
import { getRedis } from "@ray/jobs";
import type { FastifyReply } from "fastify";
import { getDb } from "@ray/database";

@Controller("health")
export class HealthController {
  private readonly db = getDb();

  @Get("live")
  live(): { status: string } {
    return { status: "ok" };
  }

  @Get("ready")
  async ready(@Res({ passthrough: true }) reply: FastifyReply) {
    const checks = await Promise.all([
      this.check("postgres", () => this.db.$queryRaw`SELECT 1`),
      this.check("redis", () => getRedis().ping()),
    ]);
    const healthy = checks.every((c) => c.status === "ok");
    reply.code(healthy ? 200 : 503);
    return { status: healthy ? "ok" : "degraded", checks };
  }

  private async check(name: string, probe: () => Promise<unknown>) {
    try {
      // maxRetriesPerRequest:null makes ioredis queue commands forever while Redis is down,
      // so probes must be bounded or readiness would hang instead of reporting 503.
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 2000),
      );
      await Promise.race([probe(), timeout]);
      return { name, status: "ok" };
    } catch (err) {
      // Detail stays server-side; the status code is the contract.
      return { name, status: "error", error: err instanceof Error ? err.message : "unknown" };
    }
  }
}
