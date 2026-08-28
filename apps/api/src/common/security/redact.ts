// Masks PII / secrets in structured logs. Key-based: values whose key matches a
// sensitive or PII pattern are masked. Apply to request-side data (tool args,
// caller info) before persisting — not to catalog output, which contains product
// "name" fields we must not clobber.
const SENSITIVE_KEY = /^(authorization|password|passwd|secret|token|apikey|api_key|signature|sign|cookie|otp)$/i;
const PII_KEY = /^(email|phone|mobile|ssn|pan|card|cvc|cvv|dob|birthdate)$/i;

function maskString(v: string): string {
  if (v.length <= 2) return "**";
  return v.slice(0, 2) + "***" + v.slice(-2);
}

export function redactSensitive<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || value === undefined || typeof value !== "object") return value;
  if (seen.has(value as object)) return value;
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((x) => redactSensitive(x, seen)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(k)) {
      out[k] = "[REDACTED]";
    } else if (PII_KEY.test(k)) {
      out[k] = typeof v === "string" ? maskString(v) : "[REDACTED]";
    } else {
      out[k] = redactSensitive(v, seen);
    }
  }
  return out as T;
}
