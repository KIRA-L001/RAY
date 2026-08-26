import { z } from "zod";
import { EVENT_TYPES } from "@ray/types";

// ponytail: batch cap of 100 is a soft ceiling; tune with a body-size limit at the HTTP layer if abuse shows up

/** Explicit identity data (spec §13): accepted only when supplied intentionally,
 * validated here, then stored in Customer/CustomerIdentity — never in event.data. */
export const identifyDataSchema = z
  .object({
    customerId: z.string().regex(/^cust_[\w-]+$/).optional(),
    email: z.string().email().max(320).optional(),
    phone: z.string().regex(/^\+?[0-9]{7,20}$/).optional(),
    name: z.string().trim().min(1).max(200).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "customer_identified requires at least one identity field",
  });

export type IdentifyData = z.infer<typeof identifyDataSchema>;

const baseEventSchema = z.object({
  eventId: z.string().regex(/^evt_[\w-]+$/, "eventId must be evt_-prefixed"),
  eventType: z.enum(EVENT_TYPES),
  merchantId: z.null(),
  websiteId: z.string().max(128).nullable(),
  sessionId: z.string().regex(/^sess_[\w-]+$/),
  customerId: z.string().regex(/^cust_[\w-]+$/).nullable(),
  anonymousId: z.string().regex(/^anon_[\w-]+$/),
  timestamp: z.string().datetime(),
  source: z.literal("sdk"),
  schemaVersion: z.literal(1),
  data: z.record(z.string(), z.unknown()).default({}),
});

/** Canonical envelope validation (spec §12). Server-side half of @ray/types EventEnvelope.
 * merchantId is never accepted from clients — it is resolved from the site key.
 * customer_identified payloads must carry valid explicit identity data (spec §13);
 * PII is stripped by the service before persistence, not here. */
export const eventEnvelopeSchema = baseEventSchema.superRefine((evt, ctx) => {
  if (evt.eventType !== "customer_identified") return;
  if (!identifyDataSchema.safeParse(evt.data).success) {
    ctx.addIssue({ code: "custom", path: ["data"], message: "invalid identity data" });
  }
});

export const eventBatchSchema = z.array(eventEnvelopeSchema).min(1).max(100);

export type ValidatedEvent = z.infer<typeof eventEnvelopeSchema>;
