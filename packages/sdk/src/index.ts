import type { EventEnvelope, SdkEventType } from "@ray/types";

export interface RayConfig {
  /** RAY ingest base URL, e.g. "https://api.ray.example". */
  endpoint: string;
  /** Publishable website identifier. Never a secret. */
  websiteId: string;
  sessionId?: string;
  anonymousId?: string;
  /** Queue size that triggers an automatic flush. Default 10. */
  flushAt?: number;
  fetchImpl?: typeof globalThis.fetch;
}

export interface IdentifyProps {
  customerId?: string;
  email?: string;
  phone?: string;
  name?: string;
}

const DEFAULT_FLUSH_AT = 10;

/**
 * Browser event sensor (spec §11). Holds no secrets; every payload is
 * untrusted client data — the server re-validates identity and tenant.
 */
export function createRay(config: RayConfig) {
  const fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const flushAt = config.flushAt ?? DEFAULT_FLUSH_AT;
  const queue: EventEnvelope[] = [];
  // ponytail: `let` reserved for Task 36 (session tracking) which will reassign these
  const sessionId = config.sessionId ?? crypto.randomUUID();
  const anonymousId = config.anonymousId ?? crypto.randomUUID();

  function envelope(eventType: SdkEventType, data: Record<string, unknown>): EventEnvelope {
    return {
      eventId: crypto.randomUUID(),
      eventType,
      merchantId: null,
      websiteId: config.websiteId,
      sessionId,
      customerId: null,
      anonymousId,
      timestamp: new Date().toISOString(),
      source: "sdk",
      schemaVersion: 1,
      data,
    };
  }

  // ponytail: fire-and-forget fetch keepalive only (no sendBeacon, no retries);
  // add a beacon fallback or retry queue if ingestion loss shows up in analytics
  function send(events: EventEnvelope[]): void {
    void fetchImpl(`${config.endpoint}/v1/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(events),
      keepalive: true,
    }).catch(() => {});
  }

  function flush(): void {
    if (queue.length === 0) return;
    send(queue.splice(0));
  }

  function track(eventType: SdkEventType, data: Record<string, unknown> = {}): void {
    queue.push(envelope(eventType, data));
    if (queue.length >= flushAt) flush();
  }

  function identify(props: IdentifyProps): void {
    track("customer_identified", { ...props });
  }

  return { track, identify, flush };
}

export type Ray = ReturnType<typeof createRay>;
