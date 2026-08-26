import { Injectable } from "@nestjs/common";
import { getDb } from "@ray/database";
import { newId } from "@ray/types";
import { AppException } from "../../common/errors/app.exception";

export interface CartItemInput {
  productId: string;
  variantId?: string;
  quantity: number;
}

export interface CreateCartInput {
  merchantId: string;
  customerId?: string;
  sessionId?: string;
  currency?: string;
  items?: CartItemInput[];
}

@Injectable()
export class CartService {
  private readonly db = getDb();

  /** Create a cart (optionally with initial items) for a tenant. */
  async create(input: CreateCartInput) {
    const { lines, currency } = await this.priceLines(input.merchantId, input.items ?? []);
    const cart = await this.db.cart.create({
      data: {
        id: newId("cart"),
        merchantId: input.merchantId,
        customerId: input.customerId,
        sessionId: input.sessionId,
        currency: currency ?? input.currency ?? "USD",
        items: { create: lines.map((l) => ({ ...l, id: newId("item") })) },
      },
      select: { id: true, currency: true, status: true, items: { select: { id: true } } },
    });
    return cart;
  }

  /** Add items to an existing, tenant-scoped cart. */
  async addItems(input: { merchantId: string; cartId: string; items: CartItemInput[] }) {
    await this.requireCart(input.merchantId, input.cartId);
    const { lines } = await this.priceLines(input.merchantId, input.items);
    await this.db.cartItem.createMany({ data: lines.map((l) => ({ ...l, id: newId("item"), cartId: input.cartId })) });
    return this.summary(input.cartId);
  }

  /** Set an item's quantity; quantity <= 0 removes it. */
  async updateItem(input: { merchantId: string; cartId: string; itemId: string; quantity: number }) {
    await this.requireCart(input.merchantId, input.cartId);
    if (input.quantity <= 0) {
      await this.db.cartItem.deleteMany({ where: { id: input.itemId, cartId: input.cartId } });
    } else {
      await this.db.cartItem.updateMany({
        where: { id: input.itemId, cartId: input.cartId },
        data: { quantity: Math.max(1, Math.floor(input.quantity)) },
      });
    }
    return this.summary(input.cartId);
  }

  private async requireCart(merchantId: string, cartId: string) {
    const cart = await this.db.cart.findUnique({ where: { id: cartId, merchantId }, select: { id: true } });
    if (!cart) throw new AppException(404, "CART_NOT_FOUND", "Cart not found");
  }

  private async summary(cartId: string) {
    const cart = await this.db.cart.findUnique({
      where: { id: cartId },
      select: { id: true, currency: true, status: true, items: { select: { id: true } } },
    });
    if (!cart) throw new AppException(404, "CART_NOT_FOUND", "Cart not found");
    return cart;
  }

  // ponytail: no stock/availability or multi-currency validation yet; add before production checkout.
  private async priceLines(merchantId: string, items: CartItemInput[]) {
    const lines: Array<{ productId: string; variantId: string | null; quantity: number; unitPriceMinor: number }> = [];
    let currency: string | undefined;
    for (const it of items) {
      const qty = Math.max(1, Math.floor(Number(it.quantity) || 1));
      const product = await this.db.product.findUnique({
        where: { id: String(it.productId ?? ""), merchantId },
        select: {
          id: true,
          currency: true,
          priceMinor: true,
          deletedAt: true,
          variants: { where: { id: it.variantId ?? "__none__", deletedAt: null }, select: { id: true, priceMinor: true } },
        },
      });
      if (!product || product.deletedAt) {
        throw new AppException(404, "PRODUCT_NOT_FOUND", "Product not found");
      }
      const variant = it.variantId ? product.variants[0] : undefined;
      const unitPriceMinor = variant?.priceMinor ?? product.priceMinor;
      if (currency === undefined) currency = product.currency;
      lines.push({ productId: product.id, variantId: variant?.id ?? null, quantity: qty, unitPriceMinor });
    }
    return { lines, currency };
  }
}
