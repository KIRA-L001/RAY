const BLOCKED_HOSTNAMES = new Set(["localhost", "0.0.0.0", "::1", "::"]);

function ipv4ToLong(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.length !== 4 || parts.some((p) => p > 255)) return null;
  return ((parts[0] ?? 0) << 24) | ((parts[1] ?? 0) << 16) | ((parts[2] ?? 0) << 8) | (parts[3] ?? 0);
}

function isPrivateIp(ip: string): boolean {
  const v4 = ipv4ToLong(ip);
  if (v4 !== null) {
    const n = v4 >>> 0;
    if (n === 0) return true; // 0.0.0.0
    if ((n & 0xff000000) >>> 0 === 0x7f000000) return true; // 127/8 loopback
    if ((n & 0xff000000) >>> 0 === 0x0a000000) return true; // 10/8
    if ((n & 0xfff00000) >>> 0 === 0xac100000) return true; // 172.16/12
    if ((n & 0xffff0000) >>> 0 === 0xc0a80000) return true; // 192.168/16
    if ((n & 0xffff0000) >>> 0 === 0xa9fe0000) return true; // 169.254/16 link-local + cloud metadata
    return false;
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::1" || v6 === "::") return true;
  if (v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80")) return true; // ULA / link-local
  return false;
}

/** Throws if the URL uses a non-http(s) scheme or resolves to a private/loopback/link-local host. */
export function assertPublicUrl(url: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`invalid url: ${url}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`blocked scheme ${u.protocol} in ${url}`);
  }
  const host = u.hostname.toLowerCase();
  if (isPrivateIp(host.replace(/^\[|\]$/g, ""))) throw new Error(`blocked private host ${url}`);
  if (BLOCKED_HOSTNAMES.has(host)) throw new Error(`blocked host ${url}`);
  // ponytail: no DNS resolution, so a public hostname that resolves to a private IP
  // (DNS rebinding / TOCTOU) is not caught here. Upgrade path: resolve + recheck per
  // connect, or enforce an egress allowlist / network firewall at the platform boundary.
}
