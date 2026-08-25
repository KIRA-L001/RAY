import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";

export const QUEUE_NAMES = {
  ping: "ping",
  crawl: "crawl",
  embedding: "embedding",
} as const;

let connection: Redis | undefined;

/** Shared BullMQ-compatible connection (blocking commands need maxRetriesPerRequest: null). */
export function getRedis(): Redis {
  if (!connection) {
    connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null,
    });
  }
  return connection;
}

const queues = new Map<string, Queue>();

export function getQueue(name: string): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, { connection: getRedis() });
    queues.set(name, queue);
  }
  return queue;
}

export interface PingJob {
  message: string;
}

export async function enqueuePing(message: string): Promise<void> {
  await getQueue(QUEUE_NAMES.ping).add("ping", { message } satisfies PingJob);
}

export interface CrawlWebsiteJob {
  websiteId: string;
}

export async function enqueueCrawlWebsite(websiteId: string): Promise<void> {
  await getQueue(QUEUE_NAMES.crawl).add("crawl.website", { websiteId } satisfies CrawlWebsiteJob);
}

export async function enqueueEmbedding(websiteId: string): Promise<void> {
  await getQueue(QUEUE_NAMES.embedding).add("embed.website", { websiteId } satisfies CrawlWebsiteJob);
}

/** Type-safe helper for worker apps: new worker with typed job data. */
export function createWorker<T>(name: string, processor: (data: T, jobId?: string) => Promise<void>): Worker {
  const worker = new Worker(
    name,
    async (job) => processor(job.data as T, job.id),
    { connection: getRedis() },
  );
  return worker;
}
