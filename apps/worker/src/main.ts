import { config } from "dotenv";
// pnpm --filter runs from apps/worker; the shared .env lives at the repo root
config({ path: "../../.env" });
config();

import { createWorker, getRedis, QUEUE_NAMES, type CrawlWebsiteJob } from "@ray/jobs";
import { getDb } from "@ray/database";
import { assertPublicUrl } from "@ray/types";

const db = getDb();

const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const MAX_BYTES = 2_000_000;
const MAX_RETRIES = 5;

async function fail(websiteId: string, errorCode: string, errorMessage: string): Promise<void> {
  const website = await db.website.findUnique({ where: { id: websiteId } });
  if (!website) return;
  const retryCount = website.retryCount + 1;
  // Exponential backoff capped at 30 min; after MAX_RETRIES stays FAILED until manually retriggered.
  const nextRetryAt =
    retryCount >= MAX_RETRIES ? null : new Date(Date.now() + Math.min(2 ** retryCount * 30_000, 1_800_000));
  await db.website.update({
    where: { id: websiteId },
    data: { status: "FAILED", errorCode, errorMessage, retryCount, lastAttemptAt: new Date(), nextRetryAt },
  });
}

/**
 * Onboarding step of the crawl pipeline: verify the site is publicly reachable.
 * ponytail: extraction/normalization/embedding stages land in Tasks 23-26; on success we
 * return to PENDING so the real crawler picks it up from the front of the machine.
 */
const crawlWorker = createWorker<CrawlWebsiteJob>(QUEUE_NAMES.crawl, async (job) => {
  const website = await db.website.findUnique({ where: { id: job.websiteId } });
  if (!website || website.deletedAt || (website.status !== "PENDING" && website.status !== "FAILED")) {
    return;
  }

  await db.website.update({
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
      const res = await fetch(target, {
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
    // Reachable and sane: hand back to the pipeline entrance for the real crawler.
    await db.website.update({
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
});

crawlWorker.on("failed", (job, err) => {
  console.error(`[worker:${crawlWorker.name}] job=${job?.id ?? "?"} failed: ${err.message}`);
});

console.log(`ray-worker running (${crawlWorker.name})`);

async function shutdown(): Promise<void> {
  await crawlWorker.close();
  getRedis().disconnect();
  await db.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
