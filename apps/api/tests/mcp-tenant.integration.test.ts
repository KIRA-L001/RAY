import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createMcpServer } from "../src/modules/mcp/mcp.server";
import { McpService } from "../src/modules/mcp/mcp.service";
import { signJwt } from "../src/common/auth/jwt";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-mcp-82";

const initBody = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1.0.0" } },
};

const pingBody = {
  jsonrpc: "2.0",
  id: 2,
  method: "tools/call",
  params: { name: "ping", arguments: {} },
};

async function portOf(server: { listen: (o: { port: number }) => Promise<unknown>; server: { address: () => unknown } }): Promise<number> {
  await server.listen({ port: 0 });
  const addr = server.server.address();
  return typeof addr === "object" && addr ? (addr as { port: number }).port : 0;
}

function authHeader(sub = "u1"): string {
  return `Bearer ${signJwt({ sub, email: "a@b.c" }, process.env.JWT_SECRET as string, 3600)}`;
}

test("mcp rejects requests missing the X-Ray-Merchant-Id header", async () => {
  const server = createMcpServer(new McpService(), { resolveMerchant: async () => ({ role: "OWNER" }) });
  const port = await portOf(server);
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: authHeader() },
    body: JSON.stringify(initBody),
  });
  assert.equal(res.status, 400);
  await server.close();
});

test("mcp rejects a user who is not a member of the requested merchant", async () => {
  const server = createMcpServer(new McpService(), { resolveMerchant: async (u, m) => (m === "m1" && u === "u1" ? { role: "OWNER" } : null) });
  const port = await portOf(server);
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: authHeader(),
      "x-ray-merchant-id": "m2",
    },
    body: JSON.stringify(initBody),
  });
  assert.equal(res.status, 403);
  await server.close();
});

test("mcp scopes the session to the member merchant and threads it into tools", async () => {
  const server = createMcpServer(new McpService(), { resolveMerchant: async (u, m) => (m === "m1" && u === "u1" ? { role: "OWNER" } : null) });
  const port = await portOf(server);
  const token = authHeader();
  const init = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: token, "x-ray-merchant-id": "m1" },
    body: JSON.stringify(initBody),
  });
  assert.equal(init.status, 200);
  const ping = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: token, "x-ray-merchant-id": "m1" },
    body: JSON.stringify(pingBody),
  });
  const text = await ping.text();
  assert.match(text, /pong \| merchant=m1/);
  await server.close();
});
