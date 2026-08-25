import { getDb } from "@ray/database";
import { getEmbeddingProvider, type EmbeddingProvider } from "./provider";

// Lazy: main.ts must run dotenv before the first getDb(); module-level init would run too early.
let db: ReturnType<typeof getDb>;
const database = () => (db ??= getDb());

function embeddingText(product: {
  name: string;
  description?: string | null;
  brand?: string | null;
  category?: { name?: string } | null;
}): string {
  return [product.name, product.brand, product.category?.name, product.description]
    .filter(Boolean)
    .join(" — ")
    .slice(0, 2000);
}

/** Embeds active products of the website that are missing or stale.
 * Returns null when no provider is configured (stage skipped — site must NOT become READY). */
export async function embedWebsiteProducts(websiteId: string): Promise<number | null> {
  const provider: EmbeddingProvider | null = getEmbeddingProvider();
  if (!provider) {
    console.warn("[embedding] no OPENAI_API_KEY configured; skipping embedding stage");
    return null;
  }

  const products = await database().product.findMany({
    where: { websiteId, deletedAt: null, status: "ACTIVE" },
    select: {
      id: true,
      merchantId: true,
      name: true,
      description: true,
      brand: true,
      updatedAt: true,
      category: { select: { name: true } },
      embedding: { select: { model: true, updatedAt: true } },
    },
  });

  const stale = products.filter(
    (p) => !p.embedding || p.embedding.model !== provider.model || p.embedding.updatedAt < p.updatedAt,
  );
  if (stale.length === 0) return 0;

  const vectors = await provider.embed(stale.map(embeddingText));
  for (let i = 0; i < stale.length; i++) {
    const p = stale[i];
    const vector = vectors[i];
    if (!p || !vector) continue;
    const literal = `[${vector.join(",")}]`;
    await database().$executeRaw`
      INSERT INTO "ProductEmbedding" ("productId", "merchantId", "model", "embedding", "updatedAt")
      VALUES (${p.id}, ${p.merchantId}, ${provider.model}, ${literal}::vector, now())
      ON CONFLICT ("productId")
      DO UPDATE SET embedding = ${literal}::vector, model = ${provider.model}, "updatedAt" = now()
    `;
  }
  return stale.length;
}
