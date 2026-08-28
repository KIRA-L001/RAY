import { createHmac, timingSafeEqual } from "node:crypto";

export interface WhatsAppStatusEvent {
  id: string;
  status: string;
  timestamp?: string;
}

export interface WhatsAppWebhookPayload {
  entry?: {
    changes?: {
      value?: { statuses?: WhatsAppStatusEvent[] };
    }[];
  }[];
}

const STATUS_MAP: Record<string, "SENT" | "DELIVERED" | "READ" | "FAILED"> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
  undelivered: "FAILED",
};

export function metaStatusToNotification(status: string): "SENT" | "DELIVERED" | "READ" | "FAILED" | null {
  return STATUS_MAP[status] ?? null;
}

/** Flattens a Meta webhook payload into (wamid, mappedStatus) pairs. */
export function extractStatuses(payload: WhatsAppWebhookPayload): { id: string; status: "SENT" | "DELIVERED" | "READ" | "FAILED" }[] {
  const out: { id: string; status: "SENT" | "DELIVERED" | "READ" | "FAILED" }[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const evt of change.value?.statuses ?? []) {
        const mapped = metaStatusToNotification(evt.status);
        if (mapped) out.push({ id: evt.id, status: mapped });
      }
    }
  }
  return out;
}

/** Verifies Meta's X-Hub-Signature-256 (HMAC-SHA256 of the raw body). */
export function verifyMetaSignature(rawBody: Buffer, appSecret: string, header: string): boolean {
  const prefix = "sha256=";
  if (!header.startsWith(prefix)) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(prefix + expected);
  const b = Buffer.from(header);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
