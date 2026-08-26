import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ShoppingAgentService, type AgentMessage, type ToolContext } from "../src/modules/ai-buyer/shopping-agent.service";
import type { LLMProvider } from "../src/common/llm/llm-provider.interface";
import type { CatalogService } from "../src/modules/catalog/catalog.service";

function fakeLlm(scripted: string[]): LLMProvider {
  let i = 0;
  return {
    streamChat: async function* () {
      const out = scripted[i++] ?? "";
      for (const ch of out) yield ch;
    },
  } as LLMProvider;
}

function fakeCatalog() {
  const calls: Array<{ kind: string; merchantId: string; arg: string }> = [];
  return {
    calls,
    searchProducts: async (merchantId: string, query: string) => {
      calls.push({ kind: "search", merchantId, arg: query });
      return [
        { id: "p1", name: "Test Shoe", brand: "Acme", priceMinor: 4999, currency: "USD", description: "A shoe", sourceUrl: "https://x", confidence: 0.9, category: "Shoes", thumbnailUrl: null, variantCount: 1 },
      ];
    },
    getProduct: async (merchantId: string, id: string) => {
      calls.push({ kind: "get", merchantId, arg: id });
      return { id, name: "Test Shoe", brand: "Acme", priceMinor: 4999, currency: "USD", description: "A shoe", sourceUrl: "https://x", status: "ACTIVE", variants: [], images: [] };
    },
  };
}

function collect(agent: ShoppingAgentService, history: AgentMessage[], ctx: ToolContext): Promise<string> {
  return (async () => {
    let out = "";
    for await (const token of agent.run(history, ctx)) out += token;
    return out;
  })();
}

const ctx: ToolContext = { merchantId: "m-tenant-a", customerId: "c1", sessionId: "s1" };

test("streams a plain answer when no tool is needed", async () => {
  const agent = new ShoppingAgentService(fakeLlm(["Hi! I can help you find shoes."]), fakeCatalog() as unknown as CatalogService);
  const out = await collect(agent, [{ role: "user", content: "hello" }], ctx);
  assert.equal(out, "Hi! I can help you find shoes.");
});

test("executes a tenant-scoped search tool then returns the final answer", async () => {
  const catalog = fakeCatalog();
  const agent = new ShoppingAgentService(
    fakeLlm(['{"tool":"search_products","args":{"query":"shoes"}}', "I found Test Shoe for $49.99."]),
    catalog as unknown as CatalogService,
  );
  const out = await collect(agent, [{ role: "user", content: "show me shoes" }], ctx);
  assert.ok(out.includes("Test Shoe"));
  assert.equal(catalog.calls.length, 1);
  assert.deepEqual(catalog.calls[0], { kind: "search", merchantId: "m-tenant-a", arg: "shoes" });
});

test("never lets the LLM override the merchant scope", async () => {
  const catalog = fakeCatalog();
  const agent = new ShoppingAgentService(
    fakeLlm(['{"tool":"get_product","args":{"id":"p-evil"}}', "Here are the details."]),
    catalog as unknown as CatalogService,
  );
  await collect(agent, [{ role: "user", content: "get p-evil" }], ctx);
  assert.equal(catalog.calls[0]?.merchantId, "m-tenant-a");
  assert.equal(catalog.calls[0]?.arg, "p-evil");
});

test("stops after MAX_AGENT_TURNS if the model keeps emitting tool calls", async () => {
  const catalog = fakeCatalog();
  const agent = new ShoppingAgentService(
    fakeLlm(Array.from({ length: 6 }, () => '{"tool":"search_products","args":{"query":"x"}}')),
    catalog as unknown as CatalogService,
  );
  const out = await collect(agent, [{ role: "user", content: "loop" }], ctx);
  assert.ok(out.includes("could not complete"));
  assert.ok(catalog.calls.length <= 5);
});
