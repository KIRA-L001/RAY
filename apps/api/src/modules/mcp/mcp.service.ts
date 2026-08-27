import { Injectable } from "@nestjs/common";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CatalogService } from "../catalog/catalog.service";

@Injectable()
export class McpService {
  constructor(private readonly catalog: CatalogService = new CatalogService()) {}

  createServer(merchantId?: string): McpServer {
    const server = new McpServer({ name: "ray", version: "1.0.0" });
    // ponytail: only the health tool for now; catalog tools land in later tasks
    server.registerTool(
      "ping",
      { description: "Health check for the RAY MCP server", inputSchema: {} },
      async () => ({ content: [{ type: "text", text: merchantId ? `pong | merchant=${merchantId}` : "pong" }] }),
    );
    // ponytail: catalog tools are only registered when a tenant is resolved
    // (Task 82 guarantees merchantId on every request). They are scoped to that
    // merchant via the closure, so client-supplied merchant ids are ignored.
    if (merchantId) {
      server.registerTool(
        "search_catalog",
        { description: "Search this merchant's product catalog by keyword", inputSchema: { query: z.string().min(1).max(200) } },
        async ({ query }) => ({
          content: [{ type: "text", text: JSON.stringify(await this.catalog.searchProducts(merchantId, query), null, 2) }],
        }),
      );
      server.registerTool(
        "list_products",
        { description: "List this merchant's products", inputSchema: { limit: z.number().int().min(1).max(100).optional() } },
        async ({ limit }) => ({
          content: [{ type: "text", text: JSON.stringify(await this.catalog.listProducts(merchantId, limit ?? 20), null, 2) }],
        }),
      );
    }
    return server;
  }
}
