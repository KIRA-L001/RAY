import { getDb } from "@ray/database";
import { assertPublicUrl, newId, ssrfSafeFetch } from "@ray/types";
import { crawlSite } from "./crawl";
import { fetchRobots } from "./robots";

// Lazy: main.ts must run dotenv before the first getDb(); module-level init would run too early.
let db: ReturnType<typeof getDb>;
const database = () => (db ??= getDb());

const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const MAX_BYTES = 2_000_000;
const MAX_RETRIES = 5;

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

/**
 * Onboarding + discovery stage of the crawl pipeline: verify the site is publicly reachable,
 * then run the bounded discovery crawl.
 * ponytail: extraction/normalization/embedding stages land in Task 26; on success we return to
 * PENDING so the extraction stage picks it up.
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

      // Reachable and crawled; extraction stage takes it from PENDING.
      await database().website.update({
        where: { id: website.id },
        data: { status: "PENDING", errorCode: null, errorMessage: null },
      });
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
