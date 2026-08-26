import { getDb, type Json } from "@ray/database";
import { newId } from "@ray/types";
import type { AggregateAnalyticsJob } from "@ray/jobs";

export interface DailyMetrics {
  eventCounts: Record<string, number>;
  sessions: number;
  identifiedCustomers: number;
}

function dayRange(dateStr?: string): { start: Date; end: Date; date: Date } {
  const base = dateStr ? new Date(`${dateStr}T00:00:00.000Z`) : new Date();
  const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end, date: start };
}

/** Recomputes today's (or the given day's) AnalyticsDaily rows from source events.
 * Full recompute per run: idempotent and self-healing; cheap at current scale.
 * // ponytail: O(events-of-day) groupBy scan — move to incremental counters if daily volume ever makes this slow */
export async function processAggregateAnalytics(job?: AggregateAnalyticsJob): Promise<number> {
  const db = getDb();
  const { start, end, date } = dayRange(job?.date);

  const eventGroups = await db.event.groupBy({
    by: ["merchantId", "websiteId", "eventType"],
    where: { occurredAt: { gte: start, lt: end }, websiteId: { not: null } },
    _count: { _all: true },
  });

  const sessionGroups = await db.session.groupBy({
    by: ["merchantId", "websiteId"],
    where: { startedAt: { gte: start, lt: end }, websiteId: { not: null } },
    _count: { _all: true },
  });

  const customerGroups = await db.customer.groupBy({
    by: ["merchantId"],
    where: { createdAt: { gte: start, lt: end }, deletedAt: null },
    _count: { _all: true },
  });
  const customersByMerchant = new Map(customerGroups.map((g) => [g.merchantId, g._count._all]));

  // Assemble rows keyed (merchantId, websiteId).
  interface Row {
    merchantId: string;
    websiteId: string;
    metrics: DailyMetrics;
  }
  const rows = new Map<string, Row>();
  const rowFor = (merchantId: string, websiteId: string): Row => {
    let row = rows.get(`${merchantId}:${websiteId}`);
    if (!row) {
      row = {
        merchantId,
        websiteId,
        metrics: { eventCounts: {}, sessions: 0, identifiedCustomers: 0 },
      };
      rows.set(`${merchantId}:${websiteId}`, row);
    }
    return row;
  };

  for (const g of eventGroups) {
    if (!g.websiteId) continue;
    rowFor(g.merchantId, g.websiteId).metrics.eventCounts[g.eventType] = g._count._all;
  }
  for (const g of sessionGroups) {
    if (!g.websiteId) continue;
    rowFor(g.merchantId, g.websiteId).metrics.sessions += g._count._all;
  }
  for (const [merchantId, count] of customersByMerchant) {
    // Merchant-level figure stored on each of that merchant's site rows for simple reads.
    for (const row of rows.values()) {
      if (row.merchantId === merchantId) row.metrics.identifiedCustomers = count;
    }
  }

  const dateOnly = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  for (const row of rows.values()) {
    await db.analyticsDaily.upsert({
      where: {
        merchantId_websiteId_date: {
          merchantId: row.merchantId,
          websiteId: row.websiteId,
          date: dateOnly,
        },
      },
      create: {
        id: newId("analytic"),
        merchantId: row.merchantId,
        websiteId: row.websiteId,
        date: dateOnly,
        metrics: row.metrics as unknown as Json,
        computedAt: new Date(),
      },
      update: { metrics: row.metrics as unknown as Json, computedAt: new Date() },
    });
  }

  return rows.size;
}

