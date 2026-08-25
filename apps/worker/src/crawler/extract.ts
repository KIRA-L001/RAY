import * as cheerio from "cheerio";

export interface ExtractedProduct {
  name: string;
  description?: string;
  brand?: string;
  category?: string;
  priceMinor: number;
  currency: string;
  confidence: number;
}

const SYMBOL_CURRENCY: Record<string, string> = {
  "₹": "INR",
  "Rs": "INR",
  "$": "USD",
  "€": "EUR",
  "£": "GBP",
};

function toMinor(amount: string): number | null {
  const cleaned = amount.replace(/[^\d.]/g, "");
  if (!cleaned) return null;
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

interface RawProduct {
  name?: string;
  description?: string;
  brand?: string;
  priceMinor?: number;
  currency?: string;
}

/** JSON-LD schema.org Product — the reliable structured path when present. */
function fromJsonLd($: cheerio.CheerioAPI): RawProduct | null {
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try {
      const parsed: unknown = JSON.parse($(el).text());
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      const graph =
        nodes.flatMap((n) =>
          typeof n === "object" && n !== null && "@graph" in n
            ? ((n as { "@graph": unknown[] })["@graph"] as unknown[])
            : [n],
        );
      const product = graph.find(
        (n) => typeof n === "object" && n !== null && (n as { "@type"?: unknown })["@type"] === "Product",
      ) as
        | {
            name?: string;
            description?: string;
            brand?: { name?: string } | string;
            offers?:
              | { price?: string; priceCurrency?: string }
              | Array<{ price?: string; priceCurrency?: string }>;
          }
        | undefined;
      if (!product?.name) continue;
      const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
      const priceMinor = offer?.price != null ? toMinor(String(offer.price)) : null;
      if (!priceMinor) continue;
      return {
        name: product.name,
        description: product.description,
        brand: typeof product.brand === "string" ? product.brand : product.brand?.name,
        priceMinor,
        currency: offer?.priceCurrency ?? "INR",
      };
    } catch {
      // malformed ld+json: ignore this script block
    }
  }
  return null;
}

const PRICE_TEXT = /(₹|Rs\.?|\$|€|£)\s?([\d,]+(?:\.\d{1,2})?)/;

/** Breadcrumb nav if present; falls back to the deepest meaningful URL path segment. */
function guessCategory($: cheerio.CheerioAPI, sourceUrl: string): string | undefined {
  const crumbs = $(".breadcrumb li, nav[aria-label*=breadcrumb] li, [class*=breadcrumb] li")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter((t) => t && t.length > 1 && !/^(home|>$)/i.test(t));
  // last crumb is usually the product itself; category is the one before it
  const fromBreadcrumb = crumbs.length >= 2 ? crumbs[crumbs.length - 2] : undefined;
  if (fromBreadcrumb) return fromBreadcrumb.slice(0, 100);
  try {
    const segments = new URL(sourceUrl).pathname.split("/").filter(Boolean);
    // skip generic prefixes like catalogue/c/product
    const meaningful = segments.filter((s) => !/^(catalogue|category|products?|p|item|index\.html?)$/i.test(s));
    return meaningful[0]?.replace(/[_-]+/g, " ").slice(0, 100);
  } catch {
    return undefined;
  }
}

export function extractProduct(html: string, sourceUrl?: string): ExtractedProduct | null {
  const $ = cheerio.load(html);
  let raw = fromJsonLd($);
  let confidence = 0;

  if (raw?.priceMinor && raw.name) {
    confidence = 0.9;
  } else {
    const metaPrice =
      $('meta[property="product:price:amount"]').attr("content") ??
      $('meta[property="og:price:amount"]').attr("content") ??
      $('[itemprop="price"]').attr("content") ??
      $('[itemprop="price"]').first().text();
    const metaCurrency =
      $('meta[property="product:price:currency"]').attr("content") ??
      $('[itemprop="priceCurrency"]').attr("content");
    const name =
      $("h1").first().text().trim() ||
      $('meta[property="og:title"]').attr("content") ||
      $("title").text().trim();
    const priceMinor = toMinor(metaPrice ?? "");
    if (name && priceMinor) {
      confidence = 0.7;
      raw = { ...raw, name, priceMinor, currency: raw?.currency ?? metaCurrency ?? undefined };
    }
  }

  if (!raw?.name || !raw.priceMinor) {
    // Last resort: h1/title plus a currency-symbol match anywhere in the page text.
    const name = $("h1").first().text().trim() || $("title").text().trim();
    const bodyText = $("body").text().replace(/\s+/g, " ").slice(0, 20_000);
    const match = PRICE_TEXT.exec(bodyText);
    if (!name || !match) return null;
    const priceMinor = toMinor(match[2] ?? "");
    if (!priceMinor) return null;
    confidence = 0.5;
    raw = { name, priceMinor, currency: SYMBOL_CURRENCY[(match[1] ?? "").replace(".", "")] ?? "INR" };
  }

  if (!raw.name || !raw.priceMinor) return null;
  const description =
    raw.description && raw.description.length > 500
      ? `${raw.description.slice(0, 500)}…`
      : raw.description;

  return {
    name: raw.name.slice(0, 300),
    description,
    brand: raw.brand?.slice(0, 100),
    category: sourceUrl ? guessCategory($, sourceUrl) : undefined,
    priceMinor: raw.priceMinor,
    currency: raw.currency ?? guessCurrencyFromPage($) ?? "INR",
    confidence: Math.round(confidence * 100) / 100,
  };

  function guessCurrencyFromPage(page: cheerio.CheerioAPI): string | undefined {
    const match = PRICE_TEXT.exec(page("body").text().slice(0, 5_000));
    return match?.[1] ? SYMBOL_CURRENCY[match[1].replace(".", "")] : undefined;
  }
}

export const EXTRACTOR_VERSION = "2026-08-26.1";
