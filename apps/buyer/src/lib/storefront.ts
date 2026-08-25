const API_URL = process.env.API_URL ?? "http://localhost:4000";

export interface Storefront {
  id: string;
  name: string;
  slug: string;
}

/** Public endpoint; safe to call without auth. */
export async function getStorefront(slug: string): Promise<Storefront | null> {
  try {
    const res = await fetch(`${API_URL}/v1/storefronts/${encodeURIComponent(slug)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { ok: true; data: Storefront };
    return body.data;
  } catch {
    return null;
  }
}
