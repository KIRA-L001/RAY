import { config } from "dotenv";
// pnpm --filter runs from apps/worker; the shared .env lives at the repo root
config({ path: "../../.env" });
config();

import { createWorker, getRedis, type PingJob } from "@ray/jobs";

const workers = [
  createWorker<PingJob>("ping", async (data, jobId) => {
    // Real processors (crawler, analytics, recovery) register here as their phases land.
    console.log(`[ping] job=${jobId} processed: ${data.message}`);
  }),
];

for (const w of workers) {
  w.on("failed", (job, err) => {
    console.error(`[worker:${w.name}] job=${job?.id ?? "?"} failed: ${err.message}`);
  });
}

console.log(`ray-worker running (${workers.map((w) => w.name).join(", ")})`);

async function shutdown(): Promise<void> {
  await Promise.all(workers.map((w) => w.close()));
  getRedis().disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
