import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ShoppingAgentService, type AgentMessage, type ToolContext } from "../src/modules/ai-buyer/shopping-agent.service";
import type { LLMProvider } from "../src/common/llm/llm-provider.interface";
import type { CatalogService } from "../src/modules/catalog/catalog.service";
import type { CartService } from "../src/modules/cart/cart.service";

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
    listProducts: async (merchantId: string) => {
      calls.push({ kind: "list", merchantId, arg: "" });
      return [];
    },
    getProduct: async (merchantId: string, id: string) => {
      calls.push({ kind: "get", merchantId, arg: id });
      return { id, name: "Test Shoe", brand: "Acme", priceMinor: 4999, currency: "USD", description: "A shoe", sourceUrl: "https://x", status: "ACTIVE", variants: [], images: [] };
    },
  };
}

function fakeCart() {
  const calls: Array<{ merchantId: string; items: unknown[] }> = [];
  return {
    calls,
    create: async (input: { merchantId: string; items?: unknown[] }) => {
      calls.push({ merchantId: input.merchantId, items: input.items ?? [] });
      return { id: "cart-1", currency: "USD", status: "OPEN", items: [{ id: "ci-1" }, { id: "ci-2" }] };
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
  const agent = new ShoppingAgentService(fakeLlm(["Hi! I can help you find shoes."]), fakeCatalog() as unknown as CatalogService, fakeCart() as unknown as CartService);
  const out = await collect(agent, [{ role: "user", content: "hello" }], ctx);
  assert.equal(out, "Hi! I can help you find shoes.");
});

test("executes a tenant-scoped search tool then returns the final answer", async () => {
  const catalog = fakeCatalog();
  const agent = new ShoppingAgentService(
    fakeLlm(['{"tool":"search_products","args":{"query":"shoes"}}', "I found Test Shoe for $49.99."]),
    catalog as unknown as CatalogService,
    fakeCart() as unknown as CartService,
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
    fakeCart() as unknown as CartService,
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
    fakeCart() as unknown as CartService,
  );
  const out = await collect(agent, [{ role: "user", content: "loop" }], ctx);
  assert.ok(out.includes("could not complete"));
  assert.ok(catalog.calls.length <= 5);
});

test("recommend_products delegates to semantic search when seeded", async () => {
  const catalog = fakeCatalog();
  const agent = new ShoppingAgentService(
    fakeLlm(['{"tool":"recommend_products","args":{"seed":"gift for runner"}}', "Try this shoe."]),
    catalog as unknown as CatalogService,
    fakeCart() as unknown as CartService,
  );
  const out = await collect(agent, [{ role: "user", content: "recommend something" }], ctx);
  assert.ok(out.includes("shoe"));
  const rec = catalog.calls.find((c) => c.kind === "search");
  assert.ok(rec && rec.merchantId === "m-tenant-a" && rec.arg === "gift for runner");
});

test("create_cart delegates to CartService with the resolved merchant scope", async () => {
  const cart = fakeCart();
  const agent = new ShoppingAgentService(
    fakeLlm(['{"tool":"create_cart","args":{"items":[{"productId":"p1","quantity":2}]}}', "Added to your cart."]),
    fakeCatalog() as unknown as CatalogService,
    cart as unknown as CartService,
  );
  const out = await collect(agent, [{ role: "user", content: "add it to cart" }], ctx);
  assert.ok(out.includes("cart"));
  assert.equal(cart.calls.length, 1);
  assert.equal(cart.calls[0]?.merchantId, "m-tenant-a");
  assert.equal((cart.calls[0]?.items as unknown[]).length, 1);
});

test("create_cart refuses to act without items", async () => {
  const cart = fakeCart();
  const agent = new ShoppingAgentService(
    fakeLlm(['{"tool":"create_cart","args":{}}', "Done."]),
    fakeCatalog() as unknown as CatalogService,
    cart as unknown as CartService,
  );
  await collect(agent, [{ role: "user", content: "start a cart" }], ctx);
  assert.equal(cart.calls.length, 0);
});
