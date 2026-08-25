/** Minimal robots.txt: honors Disallow prefixes for * and RAYBot groups. */
export interface RobotsPolicy {
  isAllowed(path: string): boolean;
}

const EMPTY: RobotsPolicy = { isAllowed: () => true };

export function parseRobots(body: string): RobotsPolicy {
  const groups: Array<{ agents: string[]; disallow: string[] }> = [];
  let current: { agents: string[]; disallow: string[] } | null = null;
  let lastWasAgent = false;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === "disallow") {
      lastWasAgent = false;
      if (current && value) current.disallow.push(value);
    } else {
      lastWasAgent = false;
    }
  }

  const relevant = groups.filter((g) => g.agents.includes("*") || g.agents.includes("raybot"));
  return {
    isAllowed(path: string): boolean {
      // ponytail: prefix matching only (no Allow precedence/wildcards); tighten if a site blocks us badly
      return !relevant.some((g) => g.disallow.some((d) => path.startsWith(d)));
    },
  };
}

export async function fetchRobots(origin: string): Promise<RobotsPolicy> {
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      signal: AbortSignal.timeout(5_000),
      headers: { "user-agent": "RAYBot/0.1" },
    });
    if (!res.ok) return EMPTY;
    return parseRobots(await res.text());
  } catch {
    // Unreachable robots.txt = no restrictions; the crawl itself still has global limits.
    return EMPTY;
  }
}
