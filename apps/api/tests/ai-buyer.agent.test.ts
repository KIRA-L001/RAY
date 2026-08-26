import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ShoppingAgentService, type AgentMessage, type ToolContext } from "../src/modules/ai-buyer/shopping-agent.service";
import type { LLMProvider } from "../src/common/llm/llm-provider.interface";
import type { CatalogService } from "../src/modules/catalog/catalog.service";
import type { CartService } from "../src/modules/cart/cart.service";
import type { EventsService } from "../src/modules/events/events.service";
import type { ConversationsService } from "../src/modules/conversations/conversations.service";
import type { OrderService } from "../src/modules/orders/order.service";
import type { PaymentService } from "../src/modules/payments/payment.service";

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
  const calls: Array<{ kind: string; merchantId: string; arg?: unknown }> = [];
  return {
    calls,
    create: async (input: { merchantId: string; items?: unknown[] }) => {
      calls.push({ kind: "create", merchantId: input.merchantId, arg: input.items ?? [] });
      return { id: "cart-1", currency: "USD", status: "OPEN", items: [{ id: "ci-1" }, { id: "ci-2" }] };
    },
    addItems: async (input: { merchantId: string; cartId: string; items: unknown[] }) => {
      calls.push({ kind: "add", merchantId: input.merchantId, arg: input.items });
      return { id: input.cartId, currency: "USD", status: "OPEN", items: [{ id: "ci-3" }] };
    },
    updateItem: async (input: { merchantId: string; cartId: string; itemId: string; quantity: number }) => {
      calls.push({ kind: "update", merchantId: input.merchantId, arg: input });
      return { id: input.cartId, currency: "USD", status: "OPEN", items: [] };
    },
  };
}

function fakeEvents() {
  const calls: Array<{ merchantId: string; props: unknown }> = [];
  return {
    calls,
    upsertCustomer: async (merchantId: string, props: unknown) => {
      calls.push({ merchantId, props });
      return "cust-x";
    },
  };
}

function fakeConversations() {
  const calls: Array<{ conversationId: string; customerId: string }> = [];
  return {
    calls,
    linkCustomer: async (conversationId: string, customerId: string) => {
      calls.push({ conversationId, customerId });
    },
  };
}

function fakeOrders() {
  const calls: Array<{ kind: string; merchantId: string; arg?: unknown }> = [];
  return {
    calls,
    createFromCart: async (merchantId: string, cartId: string, customerId?: string) => {
      calls.push({ kind: "create", merchantId, arg: { cartId, customerId } });
      return { id: "order-1", totalMinor: 9999, currency: "USD", status: "CREATED" };
    },
    getOrder: async (merchantId: string, orderId: string) => {
      calls.push({ kind: "get", merchantId, arg: orderId });
      return { id: orderId, status: "PAID", totalMinor: 9999, currency: "USD", createdAt: new Date().toISOString(), items: [] };
    },
    listOrders: async (merchantId: string, filter: { customerId?: string; sessionId?: string }) => {
      calls.push({ kind: "list", merchantId, arg: filter });
      return [{ id: "order-1", status: "PAID", totalMinor: 9999, currency: "USD", createdAt: new Date().toISOString() }];
    },
  };
}

function fakePayments() {
  const calls: Array<{ kind: string; merchantId: string; arg?: unknown }> = [];
  return {
    calls,
    createRazorpayOrder: async (merchantId: string, orderId: string) => {
      calls.push({ kind: "rz", merchantId, arg: orderId });
      return { orderId, razorpayOrderId: "rz-1", amountMinor: 9999, currency: "USD" };
    },
    payOrder: async (merchantId: string, orderId: string, opts?: { method?: string; customerId?: string }) => {
      calls.push({ kind: "pay", merchantId, arg: { orderId, customerId: opts?.customerId } });
      return { id: orderId, status: "PAID", totalMinor: 9999, currency: "USD" };
    },
  };
}

interface Overrides {
  catalog?: CatalogService;
  cart?: CartService;
  events?: EventsService;
  conversations?: ConversationsService;
  orders?: OrderService;
  payments?: PaymentService;
}

function makeAgent(scripted: string[], o: Overrides = {}) {
  return new ShoppingAgentService(
    fakeLlm(scripted),
    o.catalog ?? (fakeCatalog() as unknown as CatalogService),
    o.cart ?? (fakeCart() as unknown as CartService),
    o.events ?? (fakeEvents() as unknown as EventsService),
    o.conversations ?? (fakeConversations() as unknown as ConversationsService),
    o.orders ?? (fakeOrders() as unknown as OrderService),
    o.payments ?? (fakePayments() as unknown as PaymentService),
  );
}

function collect(agent: ShoppingAgentService, history: AgentMessage[], ctx: ToolContext): Promise<string> {
  return (async () => {
    let out = "";
    for await (const token of agent.run(history, ctx)) out += token;
    return out;
  })();
}

const ctx: ToolContext = { merchantId: "m-tenant-a", customerId: "c1", sessionId: "s1", conversationId: "conv-1" };

test("streams a plain answer when no tool is needed", async () => {
  const agent = makeAgent(["Hi! I can help you find shoes."]);
  assert.equal(await collect(agent, [{ role: "user", content: "hello" }], ctx), "Hi! I can help you find shoes.");
});

test("executes a tenant-scoped search tool then returns the final answer", async () => {
  const catalog = fakeCatalog();
  const agent = makeAgent(['{"tool":"search_products","args":{"query":"shoes"}}', "I found Test Shoe for $49.99."], { catalog: catalog as unknown as CatalogService });
  const out = await collect(agent, [{ role: "user", content: "show me shoes" }], ctx);
  assert.ok(out.includes("Test Shoe"));
  assert.equal(catalog.calls.length, 1);
  assert.deepEqual(catalog.calls[0], { kind: "search", merchantId: "m-tenant-a", arg: "shoes" });
});

test("never lets the LLM override the merchant scope", async () => {
  const catalog = fakeCatalog();
  const agent = makeAgent(['{"tool":"get_product","args":{"id":"p-evil"}}', "Here are the details."], { catalog: catalog as unknown as CatalogService });
  await collect(agent, [{ role: "user", content: "get p-evil" }], ctx);
  assert.equal(catalog.calls[0]?.merchantId, "m-tenant-a");
  assert.equal(catalog.calls[0]?.arg, "p-evil");
});

test("stops after MAX_AGENT_TURNS if the model keeps emitting tool calls", async () => {
  const catalog = fakeCatalog();
  const agent = makeAgent(Array.from({ length: 6 }, () => '{"tool":"search_products","args":{"query":"x"}}'), { catalog: catalog as unknown as CatalogService });
  const out = await collect(agent, [{ role: "user", content: "loop" }], ctx);
  assert.ok(out.includes("could not complete"));
  assert.ok(catalog.calls.length <= 5);
});

test("recommend_products delegates to semantic search when seeded", async () => {
  const catalog = fakeCatalog();
  const agent = makeAgent(['{"tool":"recommend_products","args":{"seed":"gift for runner"}}', "Try this shoe."], { catalog: catalog as unknown as CatalogService });
  const out = await collect(agent, [{ role: "user", content: "recommend something" }], ctx);
  assert.ok(out.includes("shoe"));
  const rec = catalog.calls.find((c) => c.kind === "search");
  assert.ok(rec && rec.merchantId === "m-tenant-a" && rec.arg === "gift for runner");
});

test("create_cart delegates to CartService with the resolved merchant scope", async () => {
  const cart = fakeCart();
  const agent = makeAgent(['{"tool":"create_cart","args":{"items":[{"productId":"p1","quantity":2}]}}', "Added to your cart."], { cart: cart as unknown as CartService });
  const out = await collect(agent, [{ role: "user", content: "add it to cart" }], ctx);
  assert.ok(out.includes("cart"));
  assert.equal(cart.calls[0]?.kind, "create");
  assert.equal(cart.calls[0]?.merchantId, "m-tenant-a");
  assert.equal((cart.calls[0]?.arg as unknown[]).length, 1);
});

test("add_to_cart delegates to CartService with the resolved merchant scope", async () => {
  const cart = fakeCart();
  const agent = makeAgent(['{"tool":"add_to_cart","args":{"cartId":"cart-1","items":[{"productId":"p1"}]}}', "Added."], { cart: cart as unknown as CartService });
  await collect(agent, [{ role: "user", content: "add another" }], ctx);
  assert.equal(cart.calls[0]?.kind, "add");
  assert.equal(cart.calls[0]?.merchantId, "m-tenant-a");
});

test("update_cart_item delegates tenant-scoped removal", async () => {
  const cart = fakeCart();
  const agent = makeAgent(['{"tool":"update_cart_item","args":{"cartId":"cart-1","itemId":"ci-1","quantity":0}}', "Removed."], { cart: cart as unknown as CartService });
  await collect(agent, [{ role: "user", content: "remove it" }], ctx);
  assert.equal(cart.calls[0]?.kind, "update");
  assert.equal(cart.calls[0]?.merchantId, "m-tenant-a");
});

test("identify_customer resolves identity and links the conversation", async () => {
  const events = fakeEvents();
  const conversations = fakeConversations();
  const agent = makeAgent(['{"tool":"identify_customer","args":{"email":"a@b.com","name":"Al"}}', "Thanks, Al!"], { events: events as unknown as EventsService, conversations: conversations as unknown as ConversationsService });
  const out = await collect(agent, [{ role: "user", content: "I'm al@b.com" }], ctx);
  assert.ok(out.includes("Al"));
  assert.equal(events.calls[0]?.merchantId, "m-tenant-a");
  assert.deepEqual(conversations.calls[0], { conversationId: "conv-1", customerId: "cust-x" });
});

test("create_order creates the internal order and a tenant-scoped Razorpay order", async () => {
  const orders = fakeOrders();
  const payments = fakePayments();
  const agent = makeAgent(['{"tool":"create_order","args":{"cartId":"cart-1"}}', "Order placed!"], {
    orders: orders as unknown as OrderService,
    payments: payments as unknown as PaymentService,
  });
  const out = await collect(agent, [{ role: "user", content: "checkout" }], ctx);
  assert.ok(out.includes("Order"));
  assert.equal(orders.calls[0]?.merchantId, "m-tenant-a");
  assert.equal((orders.calls[0]?.arg as { cartId: string }).cartId, "cart-1");
  const rz = payments.calls.find((c) => c.kind === "rz");
  assert.ok(rz && rz.merchantId === "m-tenant-a" && rz.arg === "order-1");
});

test("pay_order delegates to PaymentService with the resolved merchant scope", async () => {
  const payments = fakePayments();
  const agent = makeAgent(['{"tool":"pay_order","args":{"orderId":"order-1"}}', "Paid! Thank you."], { payments: payments as unknown as PaymentService });
  const out = await collect(agent, [{ role: "user", content: "pay now" }], ctx);
  assert.ok(out.includes("Paid"));
  assert.equal(payments.calls[0]?.kind, "pay");
  assert.equal(payments.calls[0]?.merchantId, "m-tenant-a");
  assert.equal((payments.calls[0]?.arg as { orderId: string }).orderId, "order-1");
  assert.equal((payments.calls[0]?.arg as { customerId: string }).customerId, "c1");
});

test("get_order delegates to OrderService tenant-scoped", async () => {
  const orders = fakeOrders();
  const agent = makeAgent(['{"tool":"get_order","args":{"orderId":"order-1"}}', "Here is your order."], { orders: orders as unknown as OrderService });
  const out = await collect(agent, [{ role: "user", content: "my order?" }], ctx);
  assert.ok(out.includes("order"));
  assert.equal(orders.calls[0]?.kind, "get");
  assert.equal(orders.calls[0]?.merchantId, "m-tenant-a");
  assert.equal(orders.calls[0]?.arg, "order-1");
});

test("list_orders delegates using the resolved customer", async () => {
  const orders = fakeOrders();
  const agent = makeAgent(['{"tool":"list_orders","args":{}}', "You have 1 order."], { orders: orders as unknown as OrderService });
  const out = await collect(agent, [{ role: "user", content: "my orders" }], ctx);
  assert.ok(out.includes("order"));
  assert.equal(orders.calls[0]?.kind, "list");
  assert.equal(orders.calls[0]?.merchantId, "m-tenant-a");
  assert.deepEqual(orders.calls[0]?.arg, { customerId: "c1", sessionId: "s1" });
});
