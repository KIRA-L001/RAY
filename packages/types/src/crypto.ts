import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** Prefixed opaque ID, e.g. newId("merchant") -> "merchant_<uuid>" */
export function newId<P extends string>(prefix: P): `${P}_${string}` {
  return `${prefix}_${randomUUID()}`;
}

// ponytail: uuid v4 ids are not time-ordered; switch to ULID if index locality ever shows up in profiling

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === SCRYPT_KEYLEN && timingSafeEqual(expected, actual);
}
