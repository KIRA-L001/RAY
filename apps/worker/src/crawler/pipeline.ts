import { getDb } from "@ray/database";
import { assertPublicUrl, newId, ssrfSafeFetch } from "@ray/types";
import { crawlSite } from "./crawl";
import { EXTRACTOR_VERSION, extractProduct, type ExtractedProduct } from "./extract";
import { fetchRobots } from "./robots";

// Lazy: main.ts must run dotenv before the first getDb(); module-level init would run too early.
let db: ReturnType<typeof getDb>;
const database = () => (db ??= getDb());

const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const MAX_BYTES = 2_000_000;
const MAX_RETRIES = 5;
const MAX_EXTRACT_PAGES = 20;

// ponytail: per-process lock only; move to a Redis lock if crawl workers ever scale past one instance
const inFlight = new Set<string>();

async function fail(websiteId: string, errorCode: string, errorMessage: string): Promise<void> {
  const website = await database().website.findUnique({ where: { id: websiteId } });
  if (!website) return;
  const retryCount = website.retryCount + 1;
  // Exponential backoff capped at 30 min; after MAX_RETRIES stays FAILED until manually retriggered.
  const nextRetryAt =
    retryCount >= MAX_RETRIES ? null : new Date(Date.now() + Math.min(2 ** retryCount * 30_000, 1_800_000));
  await database().website.update({
    where: { id: websiteId },
    data: { status: "FAILED", errorCode, errorMessage, retryCount, lastAttemptAt: new Date(), nextRetryAt },
  });
}

/** Fetches candidate pages and upserts extracted products. Returns count. */
async function extractCandidates(websiteId: string): Promise<number> {
  const candidates = await database().crawlPage.findMany({
    where: { websiteId, isCandidate: true },
    take: MAX_EXTRACT_PAGES,
    orderBy: { createdAt: "asc" },
  });
  let count = 0;
  for (const page of candidates) {
    try {
      const res = await ssrfSafeFetch(page.url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { "user-agent": "RAYBot/0.1 (+product extraction)" },
      });
      if (!res.ok) continue;
      const type = res.headers.get("content-type") ?? "";
      if (!type.includes("text/html")) continue;
      const html = (await res.text()).slice(0, MAX_BYTES);
      const product = extractProduct(html, page.url);
      if (!product) continue;
      await upsertProduct(websiteId, page.url, product);
      count++;
    } catch {
      // single candidate failing must not abort the batch
    }
  }
  return count;
}

async function upsertProduct(
  websiteId: string,
  sourceUrl: string,
  product_: ExtractedProduct,
): Promise<void> {
  const db = database();
  const website = await db.website.findUnique({ where: { id: websiteId }, select: { merchantId: true } });
  if (!website) return;

  // ponytail: flat category assignment; parentId tree stays unpopulated until a taxonomy need is real
  let categoryId: string | undefined;
  if (product_.category) {
    const slug =
      product_.category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) ||
      "uncategorized";
    const category = await db.category.upsert({
      where: { websiteId_slug: { websiteId, slug } },
      create: { id: newId("cat"), websiteId, merchantId: website.merchantId, name: product_.category.slice(0, 100), slug },
      update: {},
    });
    categoryId = category.id;
  }

  const data = {
    name: product_.name,
    description: product_.description,
    brand: product_.brand,
    priceMinor: product_.priceMinor,
    currency: product_.currency,
    confidence: product_.confidence,
    extractorVersion: EXTRACTOR_VERSION,
    extractedAt: new Date(),
  };
  await db.product.upsert({
    where: { websiteId_sourceUrl: { websiteId, sourceUrl } },
    create: { id: newId("prod"), websiteId, merchantId: website.merchantId, sourceUrl, categoryId, ...data },
    update: { ...data, ...(categoryId ? { categoryId } : {}) },
  });

  const product = await db.product.findFirst({
    where: { websiteId, sourceUrl },
    select: { id: true },
  });
  if (!product) return;

  // find-or-create per variant name; never delete (cartItems FK safety).
  for (const variant of product_.variants ?? []) {
    const existing = await db.productVariant.findFirst({
      where: { productId: product.id, name: variant.name, deletedAt: null },
    });
    if (existing) {
      await db.productVariant.update({
        where: { id: existing.id },
        data: { attributes: variant.attributes, available: variant.available, priceMinor: variant.priceMinor },
      });
    } else {
      await db.productVariant.create({
        data: {
          id: newId("variant"),
          productId: product.id,
          name: variant.name,
          attributes: variant.attributes,
          available: variant.available,
          priceMinor: variant.priceMinor,
        },
      });
    }
  }
}

/**
 * Onboarding + discovery stage of the crawl pipeline: verify the site is publicly reachable,
 * then run the bounded discovery crawl.
 * ponytail: normalization/embedding stages land in Tasks 27/32; on success we return to
 * PENDING so those stages pick it up.
 */
export async function processCrawlWebsite(websiteId: string): Promise<void> {
  if (inFlight.has(websiteId)) return;
  inFlight.add(websiteId);
  try {
    const website = await database().website.findUnique({ where: { id: websiteId } });
    if (!website || website.deletedAt || (website.status !== "PENDING" && website.status !== "FAILED")) {
      return;
    }

    await database().website.update({
      where: { id: website.id },
      data: { status: "CRAWLING", lastAttemptAt: new Date(), errorCode: null, errorMessage: null },
    });

    let url: URL;
    try {
      url = await assertPublicUrl(website.url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "url rejected";
      const code = msg.includes("ENOTFOUND") || msg.includes("dns") ? "DNS_FAILURE" : "SSRF_BLOCKED";
      await fail(website.id, code, msg);
      return;
    }

    try {
      let target = url;
      for (let i = 0; i <= MAX_REDIRECTS; i++) {
        // Re-validate every redirect hop against SSRF before following it.
        target = await assertPublicUrl(target.toString());
        const res = await ssrfSafeFetch(target, {
          redirect: "manual",
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: { "user-agent": "RAYBot/0.1 (+onboarding check)" },
        });
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get("location");
          if (!location) throw new Error(`redirect ${res.status} without location`);
          target = new URL(location, target);
          continue;
        }
        if (!res.ok) throw new Error(`http ${res.status}`);
        const type = res.headers.get("content-type") ?? "";
        if (!type.includes("text/html")) throw new Error(`unexpected content-type ${type}`);
        const buffer = await res.arrayBuffer();
        if (buffer.byteLength > MAX_BYTES) throw new Error("homepage too large");
        break;
      }

      // Onboarding passed: run the discovery crawl.
      const robots = await fetchRobots(url.origin);
      const crawlJob = await database().crawlJob.create({
        data: {
          id: `cj_${crypto.randomUUID()}`,
          merchantId: website.merchantId,
          websiteId: website.id,
          status: "RUNNING",
          idempotencyKey: `crawl:${website.id}:${website.retryCount}:${Date.now()}`,
          startedAt: new Date(),
        },
      });

      let pagesCrawled = 0;
      try {
        pagesCrawled = await crawlSite(website.url, robots.isAllowed, async (page) => {
          await database().crawlPage.upsert({
            where: { websiteId_url: { websiteId: website.id, url: page.url } },
            create: {
              id: newId("crawlpage"),
              websiteId: website.id,
              url: page.url,
              isCandidate: page.isCandidate,
              httpStatus: 200,
              fetchedAt: new Date(),
            },
            update: { isCandidate: page.isCandidate, httpStatus: 200, fetchedAt: new Date() },
          });
        });
        await database().crawlJob.update({
          where: { id: crawlJob.id },
          data: { status: "DONE", pagesCrawled, finishedAt: new Date() },
        });
      } catch (err) {
        await database().crawlJob.update({
          where: { id: crawlJob.id },
          data: {
            status: "FAILED",
            error: { message: err instanceof Error ? err.message.slice(0, 200) : "crawl failed" },
            finishedAt: new Date(),
          },
        });
        throw err;
      }

      // Reachable and crawled: extract products from candidate pages.
      await database().website.update({
        where: { id: website.id },
        data: { status: "EXTRACTING" },
      });
      const extracted = await extractCandidates(website.id);
      await database().website.update({
        where: { id: website.id },
        // ponytail: stays PENDING until normalize/embedding stages (Tasks 27/32) move it to READY
        data: { status: "PENDING", errorCode: null, errorMessage: null },
      });
      if (extracted > 0) {
        console.log(`[crawl] ${website.hostname}: extracted ${extracted} products`);
      }
    } catch (err) {
      await fail(
        website.id,
        "UNREACHABLE",
        err instanceof Error ? err.message.slice(0, 200) : "fetch failed",
      );
    }
  } finally {
    inFlight.delete(websiteId);
  }
}
