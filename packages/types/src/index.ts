export * from "./crypto.js";
export * from "./net.js";
export * from "./llm.js";
export * from "./events.js";

export type Currency = string;

/** Money in integer minor units (e.g. paise). Never floating point. */
export interface Money {
  /** Minor units: 449900 INR = ₹4,499.00 */
  amountMinor: number;
  currency: Currency;
}

export function money(amountMinor: number, currency: Currency): Money {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new Error(`amountMinor must be a non-negative integer, got ${amountMinor}`);
  }
  return { amountMinor, currency };
}

/** Opaque prefixed IDs like "merchant_01J..." — never sequential integers. */
export type Id<P extends string> = `${P}_${string}`;

export type MerchantId = Id<"merchant">;
export type UserId = Id<"user">;
export type WebsiteId = Id<"site">;
export type ProductId = Id<"prod">;
export type CustomerId = Id<"cust">;
export type OrderId = Id<"order">;

const ID_PREFIXES = {
  merchant: "merchant",
  user: "user",
  site: "site",
  prod: "prod",
  cust: "cust",
  order: "order",
} as const;

export function isId<P extends keyof typeof ID_PREFIXES>(
  value: unknown,
  prefix: P,
): value is Id<P> {
  return typeof value === "string" && value.startsWith(`${ID_PREFIXES[prefix]}_`);
}

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = { ok: false; error: { code: string; message: string } };
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
