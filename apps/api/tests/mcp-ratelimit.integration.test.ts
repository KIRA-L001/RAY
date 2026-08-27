import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createMcpServer } from "../src/modules/mcp/mcp.server";
import { McpService } from "../src/modules/mcp/mcp.service";
import { signJwt } from "../src/common/auth/jwt";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-mcp-87";

const initBody = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1.0.0" } },
};

async function portOf(server: { listen: (o: { port: number }) => Promise<unknown>; server: { address: () => unknown } }): Promise<number> {
  await server.listen({ port: 0 });
  const addr = server.server.address();
  return typeof addr === "object" && addr ? (addr as { port: number }).port : 0;
}

function authHeader(sub = "u1"): string {
  return `Bearer ${signJwt({ sub, email: "a@b.c" }, process.env.JWT_SECRET as string, 3600)}`;
}

// ponytail: limiter that allows exactly `n` requests per merchant, then rejects.
function limited(n: number): (merchantId: string) => boolean {
  const used = new Map<string, number>();
  return (merchantId: string) => {
    const c = (used.get(merchantId) ?? 0) + 1;
    used.set(merchantId, c);
    return c <= n;
  };
}

test("mcp enforces the per-merchant rate limit with 429", async () => {
  const server = createMcpServer(new McpService(), {
    resolveMerchant: async (u, m) => (m === "m1" && u === "u1" ? { role: "OWNER" } : null),
    rateLimit: limited(2),
  });
  const port = await portOf(server);
  const call = () =>
    fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: authHeader(), "x-ray-merchant-id": "m1" },
      body: JSON.stringify(initBody),
    });

  assert.equal((await call()).status, 200);
  assert.equal((await call()).status, 200);
  assert.equal((await call()).status, 429, "third request should be rate-limited");

  await server.close();
});
