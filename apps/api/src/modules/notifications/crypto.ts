import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";

// ponytail: config secrets (WhatsApp tokens, etc.) are stored encrypted in
// NotificationChannel.encryptedConfig. Single symmetric key from ENCRYPTION_KEY;
// fine for one-process deploys. Move to a KMS/per-tenant key if multi-tenant
// key isolation becomes a requirement.
function key(): Buffer {
  return createHash("sha256").update(process.env.ENCRYPTION_KEY ?? "dev-insecure-key-change-me").digest();
}

export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

export function decryptJson<T>(value: string): T {
  const parts = value.split(".") as [string, string, string];
  if (!parts[0] || !parts[1] || !parts[2]) throw new Error("invalid encrypted value");
  const [ivB64, tagB64, encB64] = parts;
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([decipher.update(Buffer.from(encB64, "base64")), decipher.final()]);
  return JSON.parse(dec.toString("utf8")) as T;
}
