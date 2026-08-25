import { Injectable } from "@nestjs/common";
import { enqueueCrawlWebsite } from "@ray/jobs";
import { getDb } from "@ray/database";
import { getEmbeddingProvider, type EmbeddingProvider } from "@ray/types";
import { AppException } from "../../common/errors/app.exception";

@Injectable()
export class CatalogService {
  private readonly db = getDb();
  private readonly embeddingProvider: EmbeddingProvider | null = getEmbeddingProvider();

  async searchProducts(merchantId: string, query: string): Promise<unknown> {
    const trimmed = query.trim().slice(0, 200);
    if (!trimmed) return [];

    // Semantic path: embed the query and rank by cosine distance.
    if (this.embeddingProvider) {
      try {
        const [vector] = await this.embeddingProvider.embed([trimmed]);
        if (vector?.length) {
          const literal = `[${vector.join(",")}]`;
          return await this.db.$queryRaw`
            SELECT p.id, p.name, p.brand, p."priceMinor", p.currency, p."sourceUrl",
                   1 - (e.embedding <=> ${literal}::vector) AS score
            FROM "Product" p
            JOIN "ProductEmbedding" e ON e."productId" = p.id
            WHERE p."merchantId" = ${merchantId}
              AND p.status = 'ACTIVE' AND p."deletedAt" IS NULL
              AND e.model = ${this.embeddingProvider.model}
            ORDER BY e.embedding <=> ${literal}::vector
            LIMIT 20
          `;
        }
      } catch (err) {
        console.error("[search] semantic path failed, falling back to ILIKE:", err instanceof Error ? err.message : err);
      }
    }

    // Fallback: plain substring match so search works without an embedding provider.
    return this.db.$queryRaw`
      SELECT id, name, brand, "priceMinor", currency, "sourceUrl", 1 AS score
      FROM "Product"
      WHERE "merchantId" = ${merchantId}
        AND status = 'ACTIVE' AND "deletedAt" IS NULL
        AND ("name" ILIKE ${"%" + trimmed + "%"} OR "description" ILIKE ${"%" + trimmed + "%"})
      ORDER BY "updatedAt" DESC
      LIMIT 20
    `;
  }

  async listProducts(merchantId: string, limit: number) {
    const products = await this.db.product.findMany({
      where: { merchantId, deletedAt: null, status: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
      take: Math.min(limit, 100),
      select: {
        id: true,
        name: true,
        brand: true,
        priceMinor: true,
        currency: true,
        sourceUrl: true,
        confidence: true,
        category: { select: { id: true, name: true, slug: true } },
        variants: { where: { deletedAt: null }, select: { id: true, name: true, available: true } },
        images: { orderBy: { position: "asc" }, take: 1, select: { url: true, alt: true } },
      },
    });
    return products.map((p) => ({
      id: p.id,
      name: p.name,
      brand: p.brand,
      priceMinor: p.priceMinor,
      currency: p.currency,
      sourceUrl: p.sourceUrl,
      confidence: p.confidence,
      category: p.category,
      thumbnailUrl: p.images[0]?.url ?? null,
      variantCount: p.variants.length,
    }));
  }

  /** Re-triggers the crawl pipeline; only for non-deleted, owned websites. */
  async triggerRecrawl(merchantId: string, websiteId: string): Promise<void> {
    const website = await this.db.website.findFirst({
      where: { id: websiteId, merchantId, deletedAt: null },
    });
    if (!website) {
      throw new AppException(404, "WEBSITE_NOT_FOUND", "Website not found");
    }
    if (
      (website.status === "CRAWLING" || website.status === "EXTRACTING" || website.status === "EMBEDDING") &&
      website.lastAttemptAt &&
      Date.now() - website.lastAttemptAt.getTime() < 15 * 60_000
    ) {
      throw new AppException(409, "CRAWL_IN_PROGRESS", "A crawl is already running for this website");
    }
    // Stale in-progress state (e.g. worker crash) falls through and is reset below.
    await this.db.website.update({
      where: { id: website.id },
      data: { status: "PENDING", errorCode: null, errorMessage: null, retryCount: 0, nextRetryAt: null },
    });
    try {
      await enqueueCrawlWebsite(website.id);
    } catch {
      throw new AppException(503, "QUEUE_UNAVAILABLE", "Could not queue the crawl, try again");
    }
  }
}
