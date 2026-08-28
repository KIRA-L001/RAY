// ponytail: simple fixed-window in-memory counter. Per-process only; swap for a
// shared (Redis) limiter if the API/MCP server is ever scaled across instances.
export type RateLimiter = (key: string) => boolean;

export function createInMemoryRateLimiter(max: number, windowMs: number): RateLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (key: string) => {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now >= entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (entry.count >= max) return false;
    entry.count++;
    return true;
  };
}
