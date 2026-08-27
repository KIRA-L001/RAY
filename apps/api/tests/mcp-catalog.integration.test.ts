import assert from "node:assert/strict";
import { test } from "node:test";
import { McpService } from "../src/modules/mcp/mcp.service";
import type { CatalogService } from "../src/modules/catalog/catalog.service";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const fakeCatalog = {
  searchProducts: async (merchantId: string, query: string) => [{ id: "p1", merchantId, query }],
  listProducts: async (merchantId: string, limit: number) => [{ id: "p2", merchantId, limit }],
} as unknown as CatalogService;

test("mcp catalog tools are registered and tenant-scoped to the resolved merchant", async () => {
  const server = new McpService(fakeCatalog).createServer("m1");
  const [clientT, serverT] = await InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientT);

  const list = await client.listTools();
  assert.ok(list.tools.some((t) => t.name === "search_catalog"), "search_catalog should be listed");
  assert.ok(list.tools.some((t) => t.name === "list_products"), "list_products should be listed");

  const search = await client.callTool({ name: "search_catalog", arguments: { query: "shoes" } });
  const searchText = (search.content as Array<{ text?: string }>)[0]?.text ?? "";
  assert.match(searchText, /"merchantId":\s*"m1"/);
  assert.match(searchText, /"query":\s*"shoes"/);

  const listed = await client.callTool({ name: "list_products", arguments: { limit: 5 } });
  const listText = (listed.content as Array<{ text?: string }>)[0]?.text ?? "";
  assert.match(listText, /"merchantId":\s*"m1"/);
  assert.match(listText, /"limit":\s*5/);

  await client.close();
  await server.close();
});
