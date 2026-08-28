export const MAX_ATTEMPTS = 3;

// ponytail: simple exponential backoff capped at 60s. The Task 5 queue worker
// does the actual scheduling; swap for jittered/per-channel backoff there if
// real provider rate limits demand it.
export function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 60_000);
}

export type RecoveryOutcome = "SENT" | "FAILED" | "RETRY";

export interface RecoveryDecision {
  outcome: RecoveryOutcome;
  retryAfterMs?: number;
}

/** Decide what to do after a send attempt: succeed, exhaust, or retry. */
export function classifyOutcome(result: { ok: boolean }, attempt: number): RecoveryDecision {
  if (result.ok) return { outcome: "SENT" };
  if (attempt >= MAX_ATTEMPTS) return { outcome: "FAILED" };
  return { outcome: "RETRY", retryAfterMs: backoffMs(attempt) };
}
