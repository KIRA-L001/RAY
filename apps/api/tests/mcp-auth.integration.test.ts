import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createMcpServer } from "../src/modules/mcp/mcp.server";
import { McpService } from "../src/modules/mcp/mcp.service";
import { signJwt } from "../src/common/auth/jwt";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-mcp-81";

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

test("mcp /mcp rejects a request without a bearer token", async () => {
  const server = createMcpServer(new McpService());
  const port = await portOf(server);
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(initBody),
  });
  assert.equal(res.status, 401);
  await server.close();
});

test("mcp /mcp accepts a valid bearer token", async () => {
  const server = createMcpServer(new McpService());
  const port = await portOf(server);
  const token = signJwt({ sub: "user-1", email: "a@b.c" }, process.env.JWT_SECRET as string, 3600);
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(initBody),
  });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /protocolVersion/);
  await server.close();
});

test("mcp /mcp rejects a tampered token", async () => {
  const server = createMcpServer(new McpService());
  const port = await portOf(server);
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: "Bearer not.a.jwt",
    },
    body: JSON.stringify(initBody),
  });
  assert.equal(res.status, 401);
  await server.close();
});
