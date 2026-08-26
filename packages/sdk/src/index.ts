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
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/** Reads/writes a storage-backed id, generating it on first use.
 * Falls back to a fresh in-memory id when storage is blocked
 * (iframes, privacy settings) — the sensor must never throw. */
function storedId(storage: Storage | undefined, key: string, maxAgeMs?: number): string {
  const fresh = crypto.randomUUID();
  if (!storage) return fresh;
  try {
    const raw = storage.getItem(key);
    if (raw) {
      const record = JSON.parse(raw) as { v: string; t?: number };
      if (record.v && (!maxAgeMs || record.t !== undefined && Date.now() - record.t < maxAgeMs)) {
        return record.v;
      }
    }
    storage.setItem(key, JSON.stringify({ v: fresh, t: Date.now() }));
    return fresh;
  } catch {
    return fresh;
  }
}

/**
 * Browser event sensor (spec §11). Holds no secrets; every payload is
 * untrusted client data — the server re-validates identity and tenant.
 */
export function createRay(config: RayConfig) {
  const fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const flushAt = config.flushAt ?? DEFAULT_FLUSH_AT;
  const queue: EventEnvelope[] = [];
  // ponytail: localStorage/sessionStorage only; no cross-subdomain cookie id — add if merchants use multiple subdomains
  const anonymousId =
    config.anonymousId ?? storedId(globalThis.localStorage, "ray:anon");
  let sessionId = config.sessionId ?? storedId(globalThis.sessionStorage, "ray:sess", SESSION_TIMEOUT_MS);

  function envelope(eventType: SdkEventType, sessionId: string, data: Record<string, unknown>): EventEnvelope {
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

  function currentSessionId(): string {
    // ponytail: rotation is evaluated on access, not by a timer — a page idle
    // >30min rotates lazily at next event/access instead of precisely at expiry
    if (!config.sessionId) {
      sessionId = storedId(globalThis.sessionStorage, "ray:sess", SESSION_TIMEOUT_MS);
    }
    return sessionId;
  }

  function track(eventType: SdkEventType, data: Record<string, unknown> = {}): void {
    queue.push(envelope(eventType, currentSessionId(), data));
    if (queue.length >= flushAt) flush();
  }

  function identify(props: IdentifyProps): void {
    track("customer_identified", { ...props });
  }

  return { track, identify, flush, sessionId: currentSessionId, anonymousId: () => anonymousId };
}

export type Ray = ReturnType<typeof createRay>;
