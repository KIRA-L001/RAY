import assert from "node:assert/strict";
import { test } from "node:test";
import { McpService } from "../src/modules/mcp/mcp.service";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

test("mcp server exposes a working ping tool", async () => {
  const server = new McpService().createServer();
  const [clientT, serverT] = await InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientT);

  const list = await client.listTools();
  assert.ok(list.tools.some((t) => t.name === "ping"), "ping tool should be listed");

  const res = await client.callTool({ name: "ping", arguments: {} });
  const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text;
  assert.equal(text, "pong");

  await client.close();
  await server.close();
});
