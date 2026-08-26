import { config } from "dotenv";
// pnpm --filter runs from apps/worker; the shared .env lives at the repo root
config({ path: "../../.env" });
config();

import {
  createWorker,
  enqueueCrawlWebsite,
  getRedis,
  QUEUE_NAMES,
  scheduleAnalyticsAggregation,
  type AggregateAnalyticsJob,
  type CrawlWebsiteJob,
} from "@ray/jobs";
import { getDb } from "@ray/database";
import type { PingJob } from "@ray/jobs";
import { processCrawlWebsite } from "./crawler/pipeline";
import { embedWebsiteProducts } from "./embeddings/service";
import { processAggregateAnalytics } from "./analytics/aggregator";

const db = getDb();

const workers = [
  createWorker<PingJob>(QUEUE_NAMES.ping, async (data, jobId) => {
    console.log(`[ping] job=${jobId} processed: ${data.message}`);
  }),
  createWorker<CrawlWebsiteJob>(QUEUE_NAMES.crawl, async (job) => processCrawlWebsite(job.websiteId)),
  createWorker<CrawlWebsiteJob>(QUEUE_NAMES.embedding, async (job) => {
    await db.website.update({ where: { id: job.websiteId }, data: { status: "EMBEDDING" } });
    try {
      const count = await embedWebsiteProducts(job.websiteId);
      if (count === null) {
        // No provider configured: catalog is usable but semantic search is not — keep out of READY.
        await db.website.update({ where: { id: job.websiteId }, data: { status: "PENDING" } });
        console.warn(`[embedding] website=${job.websiteId} skipped (no provider), left PENDING`);
      } else {
        await db.website.update({ where: { id: job.websiteId }, data: { status: "READY", readyAt: new Date() } });
        console.log(`[embedding] website=${job.websiteId} embedded ${count} products -> READY`);
      }
    } catch (err) {
      console.error(`[embedding] website=${job.websiteId} failed:`, err instanceof Error ? err.message.slice(0, 200) : err);
      await db.website.update({ where: { id: job.websiteId }, data: { status: "PENDING" } });
    }
  }),
  createWorker<AggregateAnalyticsJob>(QUEUE_NAMES.analytics, async (job) => {
    const rows = await processAggregateAnalytics(job);
    console.log(`[analytics] aggregated ${rows} site-day row(s)`);
  }),
];

for (const w of workers) {
  w.on("failed", (job, err) => {
    console.error(`[worker:${w.name}] job=${job?.id ?? "?"} failed: ${err.message}`);
  });
}

// ponytail: 60s recompute cadence — near-real-time dashboards need incremental counters instead
void scheduleAnalyticsAggregation(60_000).catch((err) =>
  console.error("[analytics] scheduling failed:", err.message),
);

/** Re-enqueues FAILED sites whose backoff window has elapsed. */
const RETRY_SWEEP_MS = 60_000;
const retryTimer = setInterval(() => {
  void (async () => {
    const due = await db.website.findMany({
      where: { status: "FAILED", deletedAt: null, nextRetryAt: { lte: new Date() } },
      select: { id: true },
    });
    for (const site of due) {
      console.log(`[crawl] re-enqueueing failed site ${site.id}`);
      await enqueueCrawlWebsite(site.id).catch((err) =>
        console.error(`[crawl] re-enqueue failed for ${site.id}:`, err.message),
      );
    }
  })();
}, RETRY_SWEEP_MS);

console.log(`ray-worker running (${workers.map((w) => w.name).join(", ")})`);

async function shutdown(): Promise<void> {
  clearInterval(retryTimer);
  await Promise.all(workers.map((w) => w.close()));
  getRedis().disconnect();
  await db.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
