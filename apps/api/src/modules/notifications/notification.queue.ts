import { randomUUID } from "node:crypto";
import { createWorker, getQueue, QUEUE_NAMES, type Worker } from "@ray/jobs";
import { getDb, Json } from "@ray/database";
import { MAX_ATTEMPTS } from "./recovery";
import type { NotificationSendResult, NotificationService } from "./notification.service";

export interface NotificationJobData {
  idempotencyKey: string;
  merchantId: string;
  channelType: string;
  to: string;
  body: string;
  purpose: string;
  customerId?: string;
}

export type NotificationStatus = "QUEUED" | "SENT" | "FAILED";

export interface NotificationError {
  code?: string;
  message?: string;
}

export interface SaveRow {
  idempotencyKey: string;
  merchantId: string;
  channelId: string | null;
  customerId: string | null;
  purpose: string;
  body: string;
  status: NotificationStatus;
  externalId?: string | null;
  error?: NotificationError | null;
}

export interface ProcessDeps {
  send: (o: {
    merchantId: string;
    channelType: string;
    to: string;
    body: string;
    purpose?: string;
    customerId?: string;
  }) => Promise<NotificationSendResult>;
  resolveChannelId: (merchantId: string, channelType: string) => Promise<string | null>;
  save: (row: SaveRow) => Promise<number>;
}

const base = (data: NotificationJobData) => ({
  idempotencyKey: data.idempotencyKey,
  merchantId: data.merchantId,
  customerId: data.customerId ?? null,
  purpose: data.purpose,
  body: data.body,
});

/** Core send-loop step. Returns "retry" when the caller should re-enqueue. */
export async function processNotification(data: NotificationJobData, deps: ProcessDeps): Promise<"done" | "retry"> {
  const channelId = await deps.resolveChannelId(data.merchantId, data.channelType);
  if (!channelId) {
    await deps.save({ ...base(data), channelId: null, status: "FAILED", error: { code: "channel_not_found" } });
    return "done";
  }

  const result = await deps.send({
    merchantId: data.merchantId,
    channelType: data.channelType,
    to: data.to,
    body: data.body,
    purpose: data.purpose,
    customerId: data.customerId,
  });

  const attempts = await deps.save({
    ...base(data),
    channelId,
    status: result.ok ? "SENT" : "QUEUED",
    externalId: result.ok ? result.externalId ?? null : null,
    error: result.ok ? undefined : { code: result.error },
  });

  if (result.ok) return "done";
  if (attempts >= MAX_ATTEMPTS) {
    await deps.save({ ...base(data), channelId, status: "FAILED", error: { code: result.error } });
    return "done";
  }
  return "retry";
}

export async function enqueueNotification(data: NotificationJobData): Promise<void> {
  // ponytail: BullMQ auto-retries up to MAX_ATTEMPTS with exponential backoff.
  // Recovery policy (classifyOutcome) decides FAILED; the worker throws on
  // "retry" so BullMQ handles the delay. Swap for a dead-letter queue later.
  await getQueue(QUEUE_NAMES.notifications).add(data.idempotencyKey, data, {
    jobId: data.idempotencyKey,
    attempts: MAX_ATTEMPTS,
    backoff: { type: "exponential", delay: 1000 },
  });
}

function realDeps(service: NotificationService): ProcessDeps {
  return {
    send: (o) => service.send(o),
    resolveChannelId: async (merchantId, channelType) =>
      (await getDb().notificationChannel.findFirst({ where: { merchantId, type: channelType }, select: { id: true } }))?.id ?? null,
    save: async (row) => {
      const saved = await getDb().notification.upsert({
        where: { idempotencyKey: row.idempotencyKey },
        create: {
          id: randomUUID(),
          idempotencyKey: row.idempotencyKey,
          merchantId: row.merchantId,
          channelId: row.channelId,
          customerId: row.customerId,
          purpose: row.purpose,
          body: row.body,
          status: row.status,
          externalId: row.externalId ?? null,
          error: (row.error ?? null) as Json,
          attempts: 1,
        },
        update: {
          status: row.status,
          externalId: row.externalId ?? null,
          error: (row.error ?? null) as Json,
          attempts: { increment: 1 },
        },
      });
      return saved.attempts;
    },
  };
}

export function startNotificationWorker(service: NotificationService): Worker {
  return createWorker<NotificationJobData>(QUEUE_NAMES.notifications, async (data) => {
    const result = await processNotification(data, realDeps(service));
    if (result === "retry") throw new Error("notification_send_failed_retry");
  });
}
