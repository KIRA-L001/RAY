import { createHmac, timingSafeEqual } from "node:crypto";

export interface JwtPayload {
  sub: string;
  email: string;
  adminRole?: string | null;
  exp: number;
}

export function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === "change-me") {
    throw new Error("JWT_SECRET is not configured");
  }
  return secret;
}

export function signJwt(payload: Omit<JwtPayload, "exp">, secret: string, ttlSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const head = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds })).toString("base64url");
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

/** Returns the payload or null for any invalid/expired/tampered token. */
export function verifyJwt(token: string, secret: string): JwtPayload | null {
  const [head, body, sig] = token.split(".");
  if (!head || !body || !sig) return null;
  const expected = createHmac("sha256", secret).update(`${head}.${body}`).digest();
  const actual = Buffer.from(sig, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as JwtPayload;
    if (typeof payload.exp !== "number" || typeof payload.sub !== "string") return null;
    if (payload.exp * 1000 <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
