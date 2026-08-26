import { Inject, Injectable } from "@nestjs/common";
import { LLM_PROVIDER, type LLMProvider } from "../../common/llm/llm-provider.interface";
import { CatalogService } from "../catalog/catalog.service";
import { CartService, type CartItemInput } from "../cart/cart.service";
import { EventsService } from "../events/events.service";
import { ConversationsService } from "../conversations/conversations.service";
import { OrderService } from "../orders/order.service";
import { PaymentService } from "../payments/payment.service";

export type AgentRole = "user" | "assistant" | "system" | "tool";
export type AgentMessage = { role: AgentRole; content: string };

export interface ToolContext {
  /** Resolved server-side; tools must scope every query by this, never by LLM-supplied ids. */
  merchantId: string;
  customerId?: string;
  sessionId?: string;
  conversationId?: string;
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

function toCartItems(raw: unknown): CartItemInput[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((i) => {
    const r = i as Record<string, unknown>;
    return {
      productId: String(r.productId ?? ""),
      variantId: r.variantId ? String(r.variantId) : undefined,
      quantity: Number(r.quantity ?? 1),
    };
  });
}

const SYSTEM_PROMPT = `You are RAY, a shopping assistant for an online store. Help the customer find products and refine their request. Never invent products, prices, or payments. Be concise and friendly.
When you need to look up the catalog, reply with ONLY a JSON object of the form {"tool":"<name>","args":{...}} and nothing else. Otherwise answer the customer in natural language.`;

@Injectable()
export class ShoppingAgentService {
  // tsx/esbuild does not emit decorator metadata, so injected deps use explicit @Inject.
  constructor(
    @Inject(LLM_PROVIDER) private readonly llm: LLMProvider,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(CartService) private readonly cart: CartService,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(ConversationsService) private readonly conversations: ConversationsService,
    @Inject(OrderService) private readonly orders: OrderService,
    @Inject(PaymentService) private readonly payments: PaymentService,
  ) {}

  private readonly tools: Tool[] = [
    this.searchProductsTool(),
    this.getProductTool(),
    this.recommendProductsTool(),
    this.createCartTool(),
    this.addToCartTool(),
    this.updateCartItemTool(),
    this.identifyCustomerTool(),
    this.createOrderTool(),
    this.payOrderTool(),
    this.getOrderTool(),
    this.listOrdersTool(),
  ];

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

  private createCartTool(): Tool {
    return {
      name: "create_cart",
      description: "Create a shopping cart with initial items so the customer can check out later.",
      parameters: '{ "items": Array<{ "productId": string, "variantId"?: string, "quantity"?: number }>, "currency"?: string }',
      execute: async (args, ctx) => {
        const items = toCartItems(args.items);
        if (items.length === 0) return "Provide at least one item to create a cart.";
        // ponytail: tool is the only cart-mutating entry point; tenant scope is enforced
        // in CartService (product must belong to merchantId). Updates land in Task 50.
        const cart = await this.cart.create({
          merchantId: ctx.merchantId,
          customerId: ctx.customerId,
          sessionId: ctx.sessionId,
          currency: typeof args.currency === "string" ? args.currency : undefined,
          items,
        });
        return JSON.stringify({ cartId: cart.id, currency: cart.currency, status: cart.status, itemCount: cart.items.length });
      },
    };
  }

  private addToCartTool(): Tool {
    return {
      name: "add_to_cart",
      description: "Add more items to an existing cart.",
      parameters: '{ "cartId": string, "items": Array<{ "productId": string, "variantId"?: string, "quantity"?: number }> }',
      execute: async (args, ctx) => {
        const cartId = String(args.cartId ?? "");
        if (!cartId) return "Provide the cartId.";
        const items = toCartItems(args.items);
        if (items.length === 0) return "Provide at least one item.";
        // ponytail: tenant scope enforced in CartService via (cartId, merchantId).
        const cart = await this.cart.addItems({ merchantId: ctx.merchantId, cartId, items });
        return JSON.stringify({ cartId: cart.id, itemCount: cart.items.length });
      },
    };
  }

  private updateCartItemTool(): Tool {
    return {
      name: "update_cart_item",
      description: "Change an item's quantity in a cart. Set quantity to 0 to remove it.",
      parameters: '{ "cartId": string, "itemId": string, "quantity": number }',
      execute: async (args, ctx) => {
        const cartId = String(args.cartId ?? "");
        const itemId = String(args.itemId ?? "");
        const quantity = Number(args.quantity ?? 0);
        if (!cartId || !itemId) return "Provide cartId and itemId.";
        const cart = await this.cart.updateItem({ merchantId: ctx.merchantId, cartId, itemId, quantity });
        return JSON.stringify({ cartId: cart.id, itemCount: cart.items.length });
      },
    };
  }

  private identifyCustomerTool(): Tool {
    return {
      name: "identify_customer",
      description: "Record the customer's identity (email and/or phone and/or name) to attribute their cart and orders.",
      parameters: '{ "email"?: string, "phone"?: string, "name"?: string }',
      execute: async (args, ctx) => {
        const email = typeof args.email === "string" ? args.email : undefined;
        const phone = typeof args.phone === "string" ? args.phone : undefined;
        const name = typeof args.name === "string" ? args.name : undefined;
        if (!email && !phone && !name) return "Provide an email, phone, or name to identify the customer.";
        // ponytail: identity resolution is the single tenant-scoped source of truth (EventsService.upsertCustomer).
        const customerId = await this.events.upsertCustomer(ctx.merchantId, { email, phone, name });
        if (ctx.conversationId) await this.conversations.linkCustomer(ctx.conversationId, customerId);
        return JSON.stringify({ customerId });
      },
    };
  }

  private createOrderTool(): Tool {
    return {
      name: "create_order",
      description: "Create an order from an existing cart to check out.",
      parameters: '{ "cartId": string }',
      execute: async (args, ctx) => {
        const cartId = String(args.cartId ?? "");
        if (!cartId) return "Provide the cartId.";
        // ponytail: tenant scope enforced in OrderService; Razorpay order is created for client-side payment.
        const order = await this.orders.createFromCart(ctx.merchantId, cartId, ctx.customerId);
        const rz = await this.payments.createRazorpayOrder(ctx.merchantId, order.id);
        return JSON.stringify({
          orderId: order.id,
          razorpayOrderId: rz.razorpayOrderId,
          totalMinor: order.totalMinor,
          currency: order.currency,
          status: order.status,
        });
      },
    };
  }

  private payOrderTool(): Tool {
    return {
      name: "pay_order",
      description: "Pay for an order to complete the purchase. Provide Razorpay payment details if available.",
      parameters: '{ "orderId": string, "razorpayPaymentId"?: string, "razorpaySignature"?: string, "method"?: string }',
      execute: async (args, ctx) => {
        const orderId = String(args.orderId ?? "");
        if (!orderId) return "Provide the orderId.";
        const method = typeof args.method === "string" ? args.method : undefined;
        const razorpayPaymentId = typeof args.razorpayPaymentId === "string" ? args.razorpayPaymentId : undefined;
        const razorpaySignature = typeof args.razorpaySignature === "string" ? args.razorpaySignature : undefined;
        const order = await this.payments.payOrder(ctx.merchantId, orderId, {
          method,
          customerId: ctx.customerId,
          razorpayPaymentId,
          razorpaySignature,
        });
        return JSON.stringify({ orderId: order.id, status: order.status, totalMinor: order.totalMinor, currency: order.currency });
      },
    };
  }

  private getOrderTool(): Tool {
    return {
      name: "get_order",
      description: "Look up a single order by its id.",
      parameters: '{ "orderId": string }',
      execute: async (args, ctx) => {
        const orderId = String(args.orderId ?? "");
        if (!orderId) return "Provide the orderId.";
        const order = await this.orders.getOrder(ctx.merchantId, orderId);
        return JSON.stringify(order);
      },
    };
  }

  private listOrdersTool(): Tool {
    return {
      name: "list_orders",
      description: "List the customer's recent orders.",
      parameters: '{ "customerId"?: string, "sessionId"?: string }',
      execute: async (args, ctx) => {
        const customerId = typeof args.customerId === "string" ? args.customerId : ctx.customerId;
        const sessionId = typeof args.sessionId === "string" ? args.sessionId : ctx.sessionId;
        if (!customerId && !sessionId) return "No customer or session is known yet.";
        const orders = await this.orders.listOrders(ctx.merchantId, { customerId, sessionId });
        return JSON.stringify(orders);
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
