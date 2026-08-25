import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function isPrivateIPv4(ip: string): boolean {
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) ||
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
    low.startsWith("::ffff:127.") // IPv4-mapped loopback etc.
  );
}

/**
 * SSRF gate: resolves every hostname address and rejects private/reserved ranges.
 * ponytail: TOCTOU window remains (re-resolution between this check and the actual fetch);
 * crawler (Task 24) must pin resolved IPs or fetch through a proxy for full coverage.
 */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("invalid url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("only http(s) allowed");
  }
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0) throw new Error("hostname did not resolve");
  for (const { address } of addresses) {
    const family = isIP(address);
    if (family === 4 && isPrivateIPv4(address)) throw new Error(`blocked address ${address}`);
    if (family === 6 && isPrivateIPv6(address)) throw new Error(`blocked address ${address}`);
  }
  return url;
}
