import assert from "node:assert/strict";
import { test } from "node:test";
import { McpService, type ToolCallEntry } from "../src/modules/mcp/mcp.service";
import type { CatalogService } from "../src/modules/catalog/catalog.service";
import type { CartService } from "../src/modules/cart/cart.service";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const fakeCatalog = {
  searchProducts: async (merchantId: string, query: string) => [{ id: "p1", merchantId, query }],
  listProducts: async (merchantId: string, limit: number) => [{ id: "p2", merchantId, limit }],
} as unknown as CatalogService;

const fakeCart = {
  create: async (input: { merchantId: string; items?: unknown[] }) => ({ id: "c1", merchantId: input.merchantId, status: "OPEN" }),
  addItems: async (input: { merchantId: string; cartId: string; items: unknown[] }) => ({ id: input.cartId, merchantId: input.merchantId }),
} as unknown as CartService;

test("every tool call is logged with merchant, tool name, caller and status", async () => {
  const calls: ToolCallEntry[] = [];
  const server = new McpService(fakeCatalog, fakeCart, (e) => { calls.push(e); }).createServer("m1", "OWNER", { sub: "u1", role: "OWNER" });
  const [clientT, serverT] = await InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientT);

  await client.callTool({ name: "search_catalog", arguments: { query: "shoe" } });

  assert.equal(calls.length, 1, "exactly one call should be logged");
  const c = calls[0]!;
  assert.equal(c.toolName, "search_catalog");
  assert.equal(c.merchantId, "m1");
  assert.equal(c.status, "OK");
  assert.deepEqual(c.callerInfo, { sub: "u1", role: "OWNER" });
  assert.ok(c.durationMs >= 0);

  await client.close();
  await server.close();
});
