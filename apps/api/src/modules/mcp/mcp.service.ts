import { Injectable } from "@nestjs/common";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { CatalogService } from "../catalog/catalog.service";
import { CartService } from "../cart/cart.service";

@Injectable()
export class McpService {
  // ponytail: catalog/cart are lazy so a ping-only server (and tests) never open
  // a DB connection. Real services are constructed on first use, where DATABASE_URL
  // is guaranteed (the MCP server needs the DB to serve catalogs/carts).
  private catalog?: CatalogService;
  private cart?: CartService;
  constructor(catalog?: CatalogService, cart?: CartService) {
    this.catalog = catalog;
    this.cart = cart;
  }

  private getCatalog(): CatalogService {
    if (!this.catalog) this.catalog = new CatalogService();
    return this.catalog;
  }

  private getCart(): CartService {
    if (!this.cart) this.cart = new CartService();
    return this.cart;
  }

  createServer(merchantId?: string, role?: string): McpServer {
    const server = new McpServer({ name: "ray", version: "1.0.0" });
    server.registerTool(
      "ping",
      { description: "Health check for the RAY MCP server", inputSchema: {} },
      async () => ({ content: [{ type: "text", text: merchantId ? `pong | merchant=${merchantId}` : "pong" }] }),
    );
    // ponytail: tools are only registered when a tenant is resolved (Task 82
    // guarantees merchantId on every request). They are scoped to that merchant
    // via the closure, so client-supplied merchant ids are ignored.
    if (merchantId) {
      // ponytail: VIEWER is read-only; mutating tools are denied. Per-tool
      // authorization only (no API-key/McpServer scoping yet — schema has an
      // McpServer table for that if finer control is needed later).
      const readOnly = role === "VIEWER";
      const denyMutate = (): CallToolResult => ({
        content: [{ type: "text", text: "403 forbidden: VIEWER role cannot modify the catalog" }],
        isError: true,
      });
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
      const itemSchema = z.object({ productId: z.string().min(1), variantId: z.string().optional(), quantity: z.number().int().min(1).max(999) });
      server.registerTool(
        "create_cart",
        {
          description: "Create a cart for this merchant (optionally with initial items)",
          inputSchema: {
            items: z.array(itemSchema).optional(),
            currency: z.string().optional(),
            customerId: z.string().optional(),
            sessionId: z.string().optional(),
          },
        },
        async ({ items, currency, customerId, sessionId }) => {
          if (readOnly) return denyMutate();
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  await this.getCart().create({ merchantId, items, currency, customerId, sessionId }),
                  null,
                  2,
                ),
              },
            ],
          };
        },
      );
      server.registerTool(
        "add_to_cart",
        {
          description: "Add items to an existing cart for this merchant",
          inputSchema: { cartId: z.string().min(1), items: z.array(itemSchema).min(1) },
        },
        async ({ cartId, items }) => {
          if (readOnly) return denyMutate();
          return { content: [{ type: "text", text: JSON.stringify(await this.getCart().addItems({ merchantId, cartId, items }), null, 2) }] };
        },
      );
    }
    return server;
  }
}
