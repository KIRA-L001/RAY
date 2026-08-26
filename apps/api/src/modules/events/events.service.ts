import { Inject, Injectable } from "@nestjs/common";
import { getDb } from "@ray/database";
import type { ValidatedEvent } from "./events.schema";
import { AppException } from "../../common/errors/app.exception";
import { WebsitesService } from "../websites/websites.service";

@Injectable()
export class EventsService {
  private readonly db = getDb();

  // explicit token: tsx/esbuild does not emit design:paramtypes
  constructor(@Inject(WebsitesService) private readonly websites: WebsitesService) {}

  /**
   * Ingestion (spec §12): tenant is resolved from the site key, never the payload.
   * Idempotent via (merchantId, eventId) unique + skipDuplicates.
   */
  async ingest(events: ValidatedEvent[], authorization: string | undefined): Promise<{ accepted: number }> {
    const siteKey = authorization?.match(/^Bearer (sitekey_\S+)$/)?.[1];
    if (!siteKey) {
      throw new AppException(401, "UNAUTHORIZED", "Missing or malformed site key");
    }
    const site = await this.websites.resolveByPublicKey(siteKey);
    if (!site) {
      throw new AppException(401, "UNKNOWN_SITE", "Site key not recognized");
    }

    const now = new Date();
    const sessionIds = new Set(events.map((e) => e.sessionId));
    await this.db.$transaction(async (tx) => {
      for (const sessionId of sessionIds) {
        const batch = events.filter((e) => e.sessionId === sessionId);
        const first = batch[0]!;
        // Identity linking is provisional here; Task 40 owns real identity resolution.
        const identified = batch.find((e) => e.eventType === "customer_identified");
        const customerId = typeof identified?.data.customerId === "string" ? identified.data.customerId : null;
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
      await tx.event.createMany({
        data: events.map((e) => ({
          id: e.eventId,
          eventId: e.eventId,
          merchantId: site.merchantId,
          websiteId: site.id,
          sessionId: e.sessionId,
          customerId: e.customerId,
          anonymousId: e.anonymousId,
          eventType: e.eventType,
          source: e.source,
          schemaVersion: e.schemaVersion,
          data: e.data,
          occurredAt: new Date(e.timestamp),
        })),
        skipDuplicates: true,
      });
    });

    return { accepted: events.length };
  }
}
