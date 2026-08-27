import { Injectable } from "@nestjs/common";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CatalogService } from "../catalog/catalog.service";

@Injectable()
export class McpService {
  // ponytail: catalog is lazy so a ping-only server (and tests) never opens a DB
  // connection. Real CatalogService is constructed on first catalog-tool call,
  // where DATABASE_URL is guaranteed (the MCP server needs the DB to serve catalogs).
  private catalog?: CatalogService;
  constructor(catalog?: CatalogService) {
    this.catalog = catalog;
  }

  private getCatalog(): CatalogService {
    if (!this.catalog) this.catalog = new CatalogService();
    return this.catalog;
  }

  createServer(merchantId?: string): McpServer {
    const server = new McpServer({ name: "ray", version: "1.0.0" });
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
          content: [{ type: "text", text: JSON.stringify(await this.getCatalog().searchProducts(merchantId, query), null, 2) }],
        }),
      );
      server.registerTool(
        "list_products",
        { description: "List this merchant's products", inputSchema: { limit: z.number().int().min(1).max(100).optional() } },
        async ({ limit }) => ({
          content: [{ type: "text", text: JSON.stringify(await this.getCatalog().listProducts(merchantId, limit ?? 20), null, 2) }],
        }),
      );
    }
    return server;
  }
}
