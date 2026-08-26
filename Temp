import { z } from "zod";
import { EVENT_TYPES } from "@ray/types";

/** Canonical envelope validation (spec §12). Server-side half of @ray/types EventEnvelope.
 * merchantId is never accepted from clients — it is resolved from the site key. */
export const eventEnvelopeSchema = z.object({
  eventId: z.string().regex(/^evt_[\w-]+$/, "eventId must be evt_-prefixed"),
  eventType: z.enum(EVENT_TYPES),
  merchantId: z.null(),
  websiteId: z.string().min(1).max(128),
  sessionId: z.string().regex(/^sess_[\w-]+$/),
  customerId: z.string().regex(/^cust_[\w-]+$/).nullable(),
  anonymousId: z.string().regex(/^anon_[\w-]+$/),
  timestamp: z.string().datetime(),
  source: z.literal("sdk"),
  schemaVersion: z.literal(1),
  data: z.record(z.string(), z.unknown()).default({}),
});

export const eventBatchSchema = z.array(eventEnvelopeSchema).min(1).max(100);

// ponytail: batch cap of 100 is a soft ceiling; tune with a body-size limit at the HTTP layer if abuse shows up

export type ValidatedEvent = z.infer<typeof eventEnvelopeSchema>;
