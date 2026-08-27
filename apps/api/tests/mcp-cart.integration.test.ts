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
  create: async (input: { merchantId: string; items?: unknown[]; currency?: string }) => ({
    id: "c1",
    merchantId: input.merchantId,
    status: "OPEN",
    currency: input.currency ?? "USD",
    itemCount: (input.items ?? []).length,
  }),
  addItems: async (input: { merchantId: string; cartId: string; items: unknown[] }) => ({
    id: input.cartId,
    merchantId: input.merchantId,
    items: input.items,
  }),
} as unknown as CartService;

test("mcp cart tools are registered and tenant-scoped to the resolved merchant", async () => {
  const server = new McpService(fakeCatalog, fakeCart).createServer("m1");
  const [clientT, serverT] = await InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientT);

  const list = await client.listTools();
  assert.ok(list.tools.some((t) => t.name === "create_cart"), "create_cart should be listed");
  assert.ok(list.tools.some((t) => t.name === "add_to_cart"), "add_to_cart should be listed");

  const created = await client.callTool({
    name: "create_cart",
    arguments: { items: [{ productId: "p1", quantity: 2 }], currency: "INR" },
  });
  const createdText = (created.content as Array<{ text?: string }>)[0]?.text ?? "";
  assert.match(createdText, /"merchantId":\s*"m1"/);
  assert.match(createdText, /"id":\s*"c1"/);

  const added = await client.callTool({
    name: "add_to_cart",
    arguments: { cartId: "c1", items: [{ productId: "p2", quantity: 1 }] },
  });
  const addedText = (added.content as Array<{ text?: string }>)[0]?.text ?? "";
  assert.match(addedText, /"merchantId":\s*"m1"/);

  await client.close();
  await server.close();
});
