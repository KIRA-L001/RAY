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

  /** Create a cart (optionally with initial items) for a tenant. Task 50 adds updates. */
  async create(input: CreateCartInput) {
    const items = input.items ?? [];
    const lines: Array<{ id: string; productId: string; variantId: string | null; quantity: number; unitPriceMinor: number }> = [];
    let currency = input.currency;
    for (const it of items) {
      const qty = Math.max(1, Math.floor(Number(it.quantity) || 1));
      const product = await this.db.product.findUnique({
        where: { id: String(it.productId ?? ""), merchantId: input.merchantId },
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
      // ponytail: no stock/availability or multi-currency validation yet; add before production checkout.
      const variant = it.variantId ? product.variants[0] : undefined;
      const unitPriceMinor = variant?.priceMinor ?? product.priceMinor;
      if (currency === undefined) currency = product.currency;
      lines.push({ id: newId("item"), productId: product.id, variantId: variant?.id ?? null, quantity: qty, unitPriceMinor });
    }

    const cart = await this.db.cart.create({
      data: {
        id: newId("cart"),
        merchantId: input.merchantId,
        customerId: input.customerId,
        sessionId: input.sessionId,
        currency: currency ?? "USD",
        items: { create: lines },
      },
      select: { id: true, currency: true, status: true, items: { select: { id: true } } },
    });
    return cart;
  }
}
