import { assertPublicUrl } from "@ray/types";

const MAX_PAGES = 50;
const MAX_DEPTH = 3;
const CONCURRENCY = 3;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 2_000_000;

// ponytail: URL-shape heuristic only; real detection upgrades in Task 26 via HTML extraction signals
const CANDIDATE_PATTERN = /\/(product|products|p|item|items|dp)(\/|$)|\/p\/|[0-9a-f]{8,}\.html$|\.(html|php)$/i;

function looksLikeProductPage(pathname: string): boolean {
  if (CANDIDATE_PATTERN.test(pathname)) return true;
  const segments = pathname.split("/").filter(Boolean);
  // Deep leaf paths (e.g. /catalogue/some-book_123/index.html) are usually detail pages.
  return segments.length >= 3;
}

export interface CrawledPage {
  url: string;
  isCandidate: boolean;
}

async function fetchPage(url: string): Promise<{ html: string; links: string[] } | null> {
  try {
    const validated = await assertPublicUrl(url);
    const res = await fetch(validated, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "user-agent": "RAYBot/0.1 (+catalog discovery)" },
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("text/html")) return null;
    const html = (await res.text()).slice(0, MAX_BYTES);
    const links = [...html.matchAll(/href="([^"#]+)"/g)].flatMap((m) => (m[1] ? [m[1]] : []));
    return { html, links };
  } catch {
    return null;
  }
}

function normalizeLink(base: string, href: string): string | null {
  try {
    const url = new URL(href, base);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
}

/** Bounded BFS restricted to the start hostname. Returns number of pages fetched. */
export async function crawlSite(
  startUrl: string,
  isAllowedByRobots: (path: string) => boolean,
  onPage: (page: CrawledPage) => Promise<void>,
): Promise<number> {
  const allowedHost = new URL(startUrl).hostname.toLowerCase();
  const start = new URL(startUrl);
  start.hash = "";
  const seen = new Set<string>([start.toString()]);
  const queue: Array<{ url: string; depth: number }> = [{ url: start.toString(), depth: 0 }];
  let crawled = 0;

  while (queue.length > 0 && crawled < MAX_PAGES) {
    const batch = queue.splice(0, CONCURRENCY);
    const results = await Promise.all(
      batch.map(async ({ url, depth }) => {
        if (depth > MAX_DEPTH || !isAllowedByRobots(new URL(url).pathname)) {
          return { page: null as CrawledPage | null, nextDepth: depth + 1, links: [] as string[] };
        }
        const fetched = await fetchPage(url);
        if (!fetched) return { page: null, nextDepth: depth + 1, links: [] };
        crawled++;
        const page: CrawledPage = { url, isCandidate: looksLikeProductPage(new URL(url).pathname) };
        await onPage(page);
        return { page, nextDepth: depth + 1, links: fetched.links };
      }),
    );

    for (let i = 0; i < batch.length; i++) {
      const entry = batch[i];
      const result = results[i];
      if (!entry || !result) continue;
      const { nextDepth, links } = result;
      for (const href of links) {
        const link = normalizeLink(entry.url, href);
        if (!link || seen.has(link)) continue;
        try {
          if (new URL(link).hostname.toLowerCase() !== allowedHost) continue;
        } catch {
          continue;
        }
        seen.add(link);
        if (nextDepth <= MAX_DEPTH) queue.push({ url: link, depth: nextDepth });
      }
    }
  }

  return crawled;
}
