import assert from "node:assert/strict";
import { test } from "node:test";
import { McpService } from "../src/modules/mcp/mcp.service";
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

async function call(role: string | undefined, tool: string, args: Record<string, unknown>) {
  const server = new McpService(fakeCatalog, fakeCart).createServer("m1", role);
  const [clientT, serverT] = await InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientT);
  const res = await client.callTool({ name: tool, arguments: args });
  await client.close();
  await server.close();
  return res;
}

test("VIEWER can read but cannot mutate", async () => {
  const read = await call("VIEWER", "search_catalog", { query: "shoe" });
  assert.notEqual(read.isError, true, "read should succeed");
  assert.ok((read.content as Array<{ text?: string }>)[0]?.text?.includes("m1"));

  const mutate = await call("VIEWER", "create_cart", { items: [{ productId: "p1", quantity: 1 }] });
  assert.equal(mutate.isError, true, "VIEWER mutation should be denied");
  assert.match((mutate.content as Array<{ text?: string }>)[0]?.text ?? "", /forbidden/);
});

test("OWNER can mutate", async () => {
  const mutate = await call("OWNER", "create_cart", { items: [{ productId: "p1", quantity: 1 }] });
  assert.notEqual(mutate.isError, true, "OWNER mutation should be allowed");
  assert.match((mutate.content as Array<{ text?: string }>)[0]?.text ?? "", /"id":\s*"c1"/);
});
