// Filesystem and network confinement helpers, shared by the render pipeline
// (render.ts) and the project store (projectstore.ts). Image inputs and output
// paths come from untrusted callers (MCP tools, REST), so raw paths are kept
// inside explicit base directories and http(s) fetches are checked against
// private/internal address ranges.

import { mkdir } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

// Mirrors PROJECTS_DIR in projectstore.ts (recomputed here to avoid a module cycle).
const DATA_DIR = process.env.APPSCREEN_PROJECTS_DIR
  ? resolve(process.env.APPSCREEN_PROJECTS_DIR)
  : resolve(process.cwd(), "projects");

/** Base directory that path-form image inputs may be read from. */
export const IMAGE_DIR = resolve(process.env.MCP_IMAGE_DIR || process.cwd());

/** Base directory that `outputPath` renders may write into. */
export const OUTPUT_DIR = resolve(process.env.MCP_OUTPUT_DIR || join(DATA_DIR, "outputs"));

/** Resolve `p` against `base` and reject any path that escapes it. */
function confinePath(base: string, p: string, what: string): string {
  const full = resolve(base, p);
  if (full !== base && !full.startsWith(base + sep)) {
    throw new Error(`${what} must stay within ${base} (got: ${p})`);
  }
  return full;
}

/** Resolve a path-form image input, confined to MCP_IMAGE_DIR. */
export function imagePathFor(p: string): string {
  return confinePath(IMAGE_DIR, p, "image path (set MCP_IMAGE_DIR to change the allowed base)");
}

/** Resolve an outputPath, confined to MCP_OUTPUT_DIR; creates parent dirs. */
export async function outputPathFor(p: string): Promise<string> {
  const full = confinePath(OUTPUT_DIR, p, "outputPath (set MCP_OUTPUT_DIR to change the allowed base)");
  await mkdir(dirname(full), { recursive: true });
  return full;
}

// ---------- SSRF guard for http(s) image fetches ----------

const ALLOW_PRIVATE = process.env.MCP_ALLOW_PRIVATE_URLS === "true";

function isPrivateV4(a: number, b: number): boolean {
  // 0/8 ("this network"), 10/8, 100.64/10 (CGNAT), 127/8 (loopback),
  // 169.254/16 (link-local, incl. cloud metadata 169.254.169.254),
  // 172.16/12, 192.168/16
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateAddress(ip: string): boolean {
  // IPv4-mapped IPv6, dotted form (::ffff:127.0.0.1)
  const v4 = ip.startsWith("::ffff:") ? ip.slice("::ffff:".length) : ip;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number);
    return isPrivateV4(a, b);
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::" || v6 === "::1" || v6 === "0:0:0:0:0:0:0:1") return true;
  // IPv4-mapped IPv6, hex form (::ffff:7f00:1)
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v6);
  if (mapped) {
    const hi = parseInt(mapped[1], 16);
    return isPrivateV4((hi >> 8) & 0xff, hi & 0xff);
  }
  // fc00::/7 (unique local) and fe80::/10 (link-local)
  return /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

/**
 * Throw when fetching `url` would reach a private / loopback / link-local /
 * metadata address (SSRF). Set MCP_ALLOW_PRIVATE_URLS=true to disable.
 */
export async function assertPublicUrl(url: string): Promise<void> {
  if (ALLOW_PRIVATE) return;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`invalid URL: ${url}`);
  }
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1); // IPv6 literal
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await lookup(host, { all: true })).map((r) => r.address);
    } catch {
      throw new Error(`could not resolve host: ${host}`);
    }
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new Error(
      `refusing to fetch private/internal address: ${url} (set MCP_ALLOW_PRIVATE_URLS=true to allow)`,
    );
  }
}
