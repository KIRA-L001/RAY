/** Canonical SDK event types (spec §11). */
export const EVENT_TYPES = [
  "page_view",
  "product_view",
  "search",
  "add_to_cart",
  "remove_from_cart",
  "checkout_started",
  "customer_identified",
] as const;

export type SdkEventType = (typeof EVENT_TYPES)[number];

/**
 * Canonical event envelope (spec §12).
 * merchantId/customerId are resolved server-side from the authenticated
 * website identity — never trusted from the client payload.
 */
export interface EventEnvelope {
  eventId: string;
  eventType: SdkEventType;
  merchantId: string | null;
  /** Resolved server-side from the authenticated site key; client value is ignored. */
  websiteId: string | null;
  sessionId: string;
  customerId: string | null;
  anonymousId: string;
  timestamp: string;
  source: "sdk";
  schemaVersion: 1;
  data: Record<string, unknown>;
}
