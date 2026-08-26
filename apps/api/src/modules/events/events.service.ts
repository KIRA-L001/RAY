import { Inject, Injectable } from "@nestjs/common";
import { getDb, type Json } from "@ray/database";
import { newId } from "@ray/types";
import { identifyDataSchema, type IdentifyData, type ValidatedEvent } from "./events.schema";
import { AppException } from "../../common/errors/app.exception";
import { WebsitesService } from "../websites/websites.service";

@Injectable()
export class EventsService {
  private readonly db = getDb();

  // explicit token: tsx/esbuild does not emit design:paramtypes
  constructor(@Inject(WebsitesService) private readonly websites: WebsitesService) {}

  /**
   * Identity resolution (spec §13): find-or-create the tenant-scoped customer
   * from explicit props. Explicit customerId wins; then email/phone match;
   * otherwise create. Never infers identity from browser data.
   */
  private async resolveCustomer(merchantId: string, props: IdentifyData): Promise<string> {
    let customer = props.customerId
      ? await this.db.customer.findFirst({ where: { id: props.customerId, merchantId, deletedAt: null } })
      : null;
    if (!customer && props.email) {
      customer = await this.db.customer.findFirst({
        where: { merchantId, email: props.email.toLowerCase(), deletedAt: null },
      });
    }
    if (!customer && props.phone) {
      customer = await this.db.customer.findFirst({
        where: { merchantId, phone: props.phone, deletedAt: null },
      });
    }

    if (!customer) {
      customer = await this.db.customer.create({
        data: {
          id: newId("cust"),
          merchantId,
          email: props.email?.toLowerCase(),
          phone: props.phone,
          name: props.name,
        },
      });
    } else if (props.email || props.phone || props.name) {
      customer = await this.db.customer.update({
        where: { id: customer.id },
        data: {
          email: props.email?.toLowerCase() ?? undefined,
          phone: props.phone ?? undefined,
          name: props.name ?? undefined,
        },
      });
    }

    await this.db.customerIdentity.createMany({
      data: [
        ...(props.email
          ? [{ id: newId("ident"), merchantId, customerId: customer.id, type: "EMAIL" as const, value: props.email.toLowerCase(), source: "sdk" }]
          : []),
        ...(props.phone
          ? [{ id: newId("ident"), merchantId, customerId: customer.id, type: "PHONE" as const, value: props.phone, source: "sdk" }]
          : []),
      ],
      skipDuplicates: true,
    });

    return customer.id;
  }

  /**
   * Ingestion (spec §12): tenant is resolved from the site key, never the payload.
   * Idempotent via (merchantId, eventId) unique + skipDuplicates.
   */
  async ingest(
    events: ValidatedEvent[],
    authorization: string | undefined,
  ): Promise<{ accepted: number; stored: number; duplicates: number }> {
    const siteKey = authorization?.match(/^Bearer (sitekey_\S+)$/)?.[1];
    if (!siteKey) {
      throw new AppException(401, "UNAUTHORIZED", "Missing or malformed site key");
    }
    const site = await this.websites.resolveByPublicKey(siteKey);
    if (!site) {
      throw new AppException(401, "UNKNOWN_SITE", "Site key not recognized");
    }

    // Resolve identities before persistence; redact PII out of event payloads (spec §13).
    const customerIdByEvent = new Map<string, string>();
    for (const e of events) {
      if (e.eventType !== "customer_identified") continue;
      const parsed = identifyDataSchema.safeParse(e.data);
      if (!parsed.success) continue;
      const customerId = await this.resolveCustomer(site.merchantId, parsed.data);
      customerIdByEvent.set(e.eventId, customerId);
      e.data = { customerId };
    }

    const now = new Date();
    const sessionIds = new Set(events.map((e) => e.sessionId));
    const identifiedBySession = new Map<string, string>();
    for (const e of events) {
      const custId = customerIdByEvent.get(e.eventId);
      if (custId || e.customerId) {
        identifiedBySession.set(e.sessionId, custId ?? e.customerId!);
      }
    }

    let stored = 0;
    await this.db.$transaction(async (tx) => {
      for (const sessionId of sessionIds) {
        const batch = events.filter((e) => e.sessionId === sessionId);
        const first = batch[0]!;
        const customerId = identifiedBySession.get(sessionId) ?? null;
        await tx.session.upsert({
          where: { id: sessionId },
          create: {
            id: sessionId,
            merchantId: site.merchantId,
            websiteId: site.id,
            anonymousId: first.anonymousId,
            customerId,
            startedAt: first.timestamp ? new Date(first.timestamp) : now,
            lastSeenAt: now,
          },
          update: { lastSeenAt: now, ...(customerId ? { customerId } : {}) },
        });
      }
      const result = await tx.event.createMany({
        data: events.map((e) => ({
          id: e.eventId,
          eventId: e.eventId,
          merchantId: site.merchantId,
          websiteId: site.id,
          sessionId: e.sessionId,
          customerId: e.customerId ?? customerIdByEvent.get(e.eventId) ?? null,
          anonymousId: e.anonymousId,
          eventType: e.eventType,
          source: e.source,
          schemaVersion: e.schemaVersion,
          data: e.data as Json,
          occurredAt: new Date(e.timestamp),
        })),
        skipDuplicates: true,
      });
      stored = result.count;
    });

    // Idempotency (spec §12): (merchantId, eventId) unique + ON CONFLICT DO NOTHING
    // makes replays and concurrent retries safe; duplicates are reported, not errors.
    return { accepted: events.length, stored, duplicates: events.length - stored };
  }
}
