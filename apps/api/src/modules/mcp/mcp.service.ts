import { Injectable } from "@nestjs/common";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getDb, type Json } from "@ray/database";
import { newId } from "@ray/types";
import { redactSensitive } from "../../common/security/redact";
import { CatalogService } from "../catalog/catalog.service";
import { CartService, type CartItemInput } from "../cart/cart.service";

export interface ToolCallEntry {
  merchantId: string;
  serverId?: string | null;
  toolName: string;
  callerInfo?: Json;
  input: Json;
  output?: Json;
  status: "OK" | "ERROR";
  durationMs: number;
}

export type ToolLogger = (entry: ToolCallEntry) => void | Promise<void>;

@Injectable()
export class McpService {
  // ponytail: catalog/cart are lazy so a ping-only server (and tests) never open
  // a DB connection. Real services are constructed on first use, where DATABASE_URL
  // is guaranteed (the MCP server needs the DB to serve catalogs/carts).
  private catalog?: CatalogService;
  private cart?: CartService;
  private logger: ToolLogger;
  constructor(catalog?: CatalogService, cart?: CartService, logger?: ToolLogger) {
    this.catalog = catalog;
    this.cart = cart;
    this.logger = logger ?? defaultToolLogger;
  }

  private getCatalog(): CatalogService {
    if (!this.catalog) this.catalog = new CatalogService();
    return this.catalog;
  }

  private getCart(): CartService {
    if (!this.cart) this.cart = new CartService();
    return this.cart;
  }

  createServer(merchantId?: string, role?: string, callerInfo?: Json): McpServer {
    const server = new McpServer({ name: "ray", version: "1.0.0" });
    server.registerTool(
      "ping",
      { description: "Health check for the RAY MCP server", inputSchema: {} },
      this.wrap(merchantId, callerInfo, "ping", async () => ({
        content: [{ type: "text", text: merchantId ? `pong | merchant=${merchantId}` : "pong" }],
      })),
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
        this.wrap(merchantId, callerInfo, "search_catalog", async ({ query }) => ({
          content: [{ type: "text", text: JSON.stringify(await this.getCatalog().searchProducts(merchantId, query as string), null, 2) }],
        })),
      );
      server.registerTool(
        "list_products",
        { description: "List this merchant's products", inputSchema: { limit: z.number().int().min(1).max(100).optional() } },
        this.wrap(merchantId, callerInfo, "list_products", async ({ limit }) => ({
          content: [{ type: "text", text: JSON.stringify(await this.getCatalog().listProducts(merchantId, (limit as number | undefined) ?? 20), null, 2) }],
        })),
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
        this.wrap(merchantId, callerInfo, "create_cart", async (args) => {
          if (readOnly) return denyMutate();
          const { items, currency, customerId, sessionId } = args as {
            items?: CartItemInput[];
            currency?: string;
            customerId?: string;
            sessionId?: string;
          };
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
        }),
      );
      server.registerTool(
        "add_to_cart",
        {
          description: "Add items to an existing cart for this merchant",
          inputSchema: { cartId: z.string().min(1), items: z.array(itemSchema).min(1) },
        },
        this.wrap(merchantId, callerInfo, "add_to_cart", async (args) => {
          if (readOnly) return denyMutate();
          const { cartId, items } = args as { cartId: string; items: CartItemInput[] };
          return { content: [{ type: "text", text: JSON.stringify(await this.getCart().addItems({ merchantId, cartId, items }), null, 2) }] };
        }),
      );
    }
    return server;
  }

  // ponytail: wraps a tool handler to persist a McpToolCall row. Logging uses a
  // best-effort logger that must never break the tool response.
  private wrap(
    merchantId: string | undefined,
    callerInfo: Json | undefined,
    toolName: string,
    handler: (args: Record<string, unknown>) => Promise<CallToolResult>,
  ) {
    return async (args: Record<string, unknown>): Promise<CallToolResult> => {
      const start = Date.now();
      try {
        const result = await handler(args);
        await this.logCall(merchantId, callerInfo, toolName, args as unknown as Json, result as unknown as Json, true, Date.now() - start);
        return result;
      } catch (err) {
        await this.logCall(
          merchantId,
          callerInfo,
          toolName,
          args as unknown as Json,
          { error: String(err) } as unknown as Json,
          false,
          Date.now() - start,
        );
        throw err;
      }
    };
  }

  private async logCall(
    merchantId: string | undefined,
    callerInfo: Json | undefined,
    toolName: string,
    input: Json,
    output: Json | undefined,
    ok: boolean,
    ms: number,
  ): Promise<void> {
    if (!merchantId) return;
    try {
      await this.logger({
        merchantId,
        serverId: null,
        toolName,
        callerInfo: callerInfo ? redactSensitive(callerInfo) : undefined,
        input: redactSensitive(input),
        output,
        status: ok ? "OK" : "ERROR",
        durationMs: ms,
      });
    } catch {
      // ponytail: logging must never break the tool call
    }
  }
}

// ponytail: default logger writes to McpToolCall. Lazy getDb() so a ping-only /
// test server opens no connection; if DATABASE_URL is absent it throws and is
// swallowed above — logging silently no-ops rather than failing the tool.
async function defaultToolLogger(entry: ToolCallEntry): Promise<void> {
  await getDb().mcpToolCall.create({
    data: {
      id: newId("mtc"),
      merchantId: entry.merchantId,
      serverId: entry.serverId ?? null,
      toolName: entry.toolName,
      callerInfo: entry.callerInfo ?? undefined,
      input: entry.input,
      output: entry.output ?? undefined,
      status: entry.status,
      durationMs: entry.durationMs,
    },
  });
}
