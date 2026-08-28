// Production deployment guardrails (Task 123). Kept dependency-free and side-effect
// free so they can be unit-tested without booting Nest.

/** Refuses to start in production with dev/insecure secrets. No-op outside production. */
export function validateProductionSecrets(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;
  const missing: string[] = [];
  if (!env.JWT_SECRET || env.JWT_SECRET === "change-me") missing.push("JWT_SECRET");
  if (!env.ENCRYPTION_KEY) missing.push("ENCRYPTION_KEY");
  if (missing.length) {
    throw new Error(`Refusing to start in production with insecure config: missing ${missing.join(", ")}`);
  }
}

/** CORS allowlist: from ALLOWED_ORIGINS in production, localhost/tauri list in dev. */
export function allowedOriginsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.ALLOWED_ORIGINS;
  if (raw) return raw.split(",").map((o) => o.trim()).filter(Boolean);
  return [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "tauri://localhost",
    "http://tauri.localhost",
  ];
}
