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
    return (await res.json()) as Storefront;
  } catch {
    return null;
  }
}
