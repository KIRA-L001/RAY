import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { isIP } from "node:net";
import { Agent } from "undici";

const INTERNAL_HOSTNAMES = /^(localhost$|.*\.(local|internal|intranet|lan|home|corp)$)/i;

function isPrivateIPv4(ip: string): boolean {
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local incl. cloud metadata 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIPv6(ip: string): boolean {
  const low = ip.toLowerCase();
  return (
    low === "::" ||
    low === "::1" ||
    low.startsWith("fc") ||
    low.startsWith("fd") ||
    low.startsWith("fe80") ||
    /^::ffff:(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(low) // IPv4-mapped private
  );
}

export function validateResolvedAddresses(addresses: Array<string | LookupAddress>): void {
  for (const entry of addresses) {
    const address = typeof entry === "string" ? entry : entry.address;
    const family = isIP(address);
    if (family === 4 && isPrivateIPv4(address)) throw new Error(`blocked address ${address}`);
    if (family === 6 && isPrivateIPv6(address)) throw new Error(`blocked address ${address}`);
  }
}

/**
 * SSRF gate: rejects non-http(s), internal hostnames, and any hostname that resolves
 * (exclusively) to private/reserved ranges.
 */
export async function assertPublicUrl(rawUrl: string | URL): Promise<URL> {
  let url: URL;
  try {
    url = rawUrl instanceof URL ? rawUrl : new URL(rawUrl);
  } catch {
    throw new Error("invalid url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("only http(s) allowed");
  }
  if (INTERNAL_HOSTNAMES.test(url.hostname)) {
    throw new Error(`blocked hostname ${url.hostname}`);
  }
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0) throw new Error("hostname did not resolve");
  validateResolvedAddresses(addresses);
  return url;
}

// DNS-rebinding defense: the connector itself only ever uses validated addresses,
// so the pre-flight check and the socket cannot disagree about resolution.
const guardedLookup = (
  hostname: string,
  options: unknown,
  callback: (err: NodeJS.ErrnoException | null, addresses?: LookupAddress[]) => void,
): void => {
  lookup(hostname, { all: true, verbatim: true })
    .then((addresses) => {
      try {
        validateResolvedAddresses(addresses);
        callback(null, addresses);
      } catch (err) {
        callback(err as NodeJS.ErrnoException);
      }
    })
    .catch((err: NodeJS.ErrnoException) => callback(err));
};

const safeAgent = new Agent({
  connect: { lookup: guardedLookup as never },
  headersTimeout: 10_000,
  bodyTimeout: 10_000,
});

/** fetch() whose TCP connection can only use SSRF-validated addresses. */
export function ssrfSafeFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return assertPublicUrl(url).then(() =>
    // global fetch honors undici's dispatcher option at runtime
    fetch(url, { ...init, dispatcher: safeAgent } as unknown as RequestInit),
  );
}
