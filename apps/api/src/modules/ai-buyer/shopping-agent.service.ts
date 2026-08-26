import { Inject, Injectable } from "@nestjs/common";
import { LLM_PROVIDER, type LLMProvider } from "../../common/llm/llm-provider.interface";
import { CatalogService } from "../catalog/catalog.service";

export type AgentRole = "user" | "assistant" | "system" | "tool";
export type AgentMessage = { role: AgentRole; content: string };

export interface ToolContext {
  /** Resolved server-side; tools must scope every query by this, never by LLM-supplied ids. */
  merchantId: string;
  customerId?: string;
  sessionId?: string;
}

export interface Tool {
  name: string;
  description: string;
  /** Human-readable arg schema, embedded in the system prompt. */
  parameters: string;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

// ponytail: bounded ReAct loop. MAX_AGENT_TURNS caps LLM cost/latency; raise if the
// agent needs multi-step plans. Tool calls are detected from the model's JSON reply
// (no provider-native function-calling) to keep LLMProvider text-only (Task 44).
const MAX_AGENT_TURNS = 5;

const SYSTEM_PROMPT = `You are RAY, a shopping assistant for an online store. Help the customer find products and refine their request. Never invent products, prices, or payments. Be concise and friendly.
When you need to look up the catalog, reply with ONLY a JSON object of the form {"tool":"<name>","args":{...}} and nothing else. Otherwise answer the customer in natural language.`;

@Injectable()
export class ShoppingAgentService {
  // tsx/esbuild does not emit decorator metadata, so injected deps use explicit @Inject.
  constructor(
    @Inject(LLM_PROVIDER) private readonly llm: LLMProvider,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  private readonly tools: Tool[] = [this.searchProductsTool(), this.getProductTool(), this.recommendProductsTool()];

  private searchProductsTool(): Tool {
    return {
      name: "search_products",
      description: "Search this merchant's catalog for products matching a query.",
      parameters: '{ "query": string, "limit"?: number }',
      execute: async (args, ctx) => {
        const query = String(args.query ?? "").slice(0, 200);
        const limit = Math.min(Number(args.limit ?? 10) || 10, 50);
        const rows = await this.catalog.searchProducts(ctx.merchantId, query);
        if (!Array.isArray(rows) || rows.length === 0) return "No products found.";
        return JSON.stringify(rows.slice(0, limit));
      },
    };
  }

  private getProductTool(): Tool {
    return {
      name: "get_product",
      description: "Get full details for a single product by its id.",
      parameters: '{ "id": string }',
      execute: async (args, ctx) => {
        const id = String(args.id ?? "");
        if (!id) return "Missing product id.";
        const product = await this.catalog.getProduct(ctx.merchantId, id);
        return product ? JSON.stringify(product) : "Product not found.";
      },
    };
  }

  private recommendProductsTool(): Tool {
    return {
      name: "recommend_products",
      description: "Recommend products based on an interest, category, or occasion.",
      parameters: '{ "seed"?: string, "category"?: string, "limit"?: number }',
      execute: async (args, ctx) => {
        const limit = Math.min(Number(args.limit ?? 8) || 8, 50);
        const query = String(args.seed ?? args.category ?? "").slice(0, 200);
        // ponytail: no popularity/sales signal yet; delegate to semantic search,
        // else fall back to recent catalog. Add a real ranking signal (views, orders)
        // before calling this "personalized".
        const rows = query
          ? await this.catalog.searchProducts(ctx.merchantId, query)
          : await this.catalog.listProducts(ctx.merchantId, limit);
        if (!Array.isArray(rows) || rows.length === 0) return "No recommendations available.";
        return JSON.stringify(rows.slice(0, limit));
      },
    };
  }

  /** Run the tool-calling loop and yield the final answer as text tokens. */
  async *run(history: AgentMessage[], ctx: ToolContext): AsyncGenerator<string> {
    const toolCatalog = this.tools.map((t) => `- ${t.name}: ${t.description} (args: ${t.parameters})`).join("\n");
    const messages: AgentMessage[] = [
      { role: "system", content: `${SYSTEM_PROMPT}\n\nTools:\n${toolCatalog}` },
      ...history,
    ];

    for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
      const reply = await this.collect(messages);
      const call = parseToolCall(reply, this.tools);
      if (!call) {
        for (const token of reply.split(/(\s+)/)) if (token) yield token;
        return;
      }
      let result: string;
      try {
        result = await call.tool.execute(call.args, ctx);
      } catch (err) {
        result = `Tool error: ${err instanceof Error ? err.message : "failed"}`;
      }
      // ponytail: tool output fed back as a user turn; trusted only as data, never as instructions.
      messages.push({ role: "user", content: `Tool result (${call.tool.name}): ${result}` });
    }
    yield "Sorry, I could not complete that request.";
  }

  private async collect(messages: AgentMessage[]): Promise<string> {
    let out = "";
    for await (const delta of this.llm.streamChat({ messages })) out += delta;
    return out;
  }
}

function parseToolCall(
  text: string,
  tools: Tool[],
): { tool: Tool; args: Record<string, unknown> } | null {
  let t = text.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const captured = fence?.[1];
  if (captured) t = captured.trim();
  if (!t.startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(t);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || typeof (parsed as Record<string, unknown>).tool !== "string") {
    return null;
  }
  const name = (parsed as Record<string, unknown>).tool as string;
  const tool = tools.find((x) => x.name === name);
  if (!tool) return null;
  const args = (parsed as Record<string, unknown>).args;
  return { tool, args: (args && typeof args === "object" ? args : {}) as Record<string, unknown> };
}
