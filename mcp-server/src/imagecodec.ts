// Image encoding primitives, shared by the project store (which compresses
// images on the way in) and imageopt.ts (which re-compresses what is already
// stored). Kept free of any project-store import so the two can depend on this
// without a module cycle.

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { OUTPUT_SIZES, type Size } from "./presets.js";

export type OptimizeFormat = "webp" | "jpeg";

export const DEFAULT_QUALITY = 82;

// Never downscale an image's longest edge below this, whatever the project's
// current output size says. The output device is a setting the user flips at any
// time (a project set to "web-og" today may export 6.9" screenshots tomorrow),
// and downscaling is the one irreversible step here — so the floor keeps every
// image big enough for the largest stock App Store output size (mac-2880 =
// 2880px, iphone-6.9 = 2868px). Projects rendering wider than that (panorama
// span, custom size) raise it themselves via recordRenderLongEdge().
export const MIN_LONG_EDGE = 2880;

export const EXT_FOR: Record<OptimizeFormat, string> = { webp: "webp", jpeg: "jpg" };

// Formats we must never re-encode: vector (no pixels to resample) and animated
// (a canvas round-trip would keep the first frame only).
export const UNTOUCHABLE = new Set(["svg", "gif"]);

export const extOf = (name: string) => (name.split(".").pop() || "").toLowerCase();

/** The output canvas one screen of this project renders to (before panorama span). */
export function baseCanvas(rec: any): Size {
  if (rec?.outputDevice === "custom") {
    return {
      width: Number(rec.customWidth) || 1290,
      height: Number(rec.customHeight) || 2796,
    };
  }
  return OUTPUT_SIZES[rec?.outputDevice || "iphone-6.9"] || OUTPUT_SIZES["iphone-6.9"];
}

/**
 * The largest edge this record can actually draw an image at: its output canvas,
 * widened by the biggest panorama span in use. Mirrors projectRenderLongEdge()
 * in app.js — no cap may fall below it, or an export would come out soft.
 */
export function recordRenderLongEdge(rec: any): number {
  const base = baseCanvas(rec);
  let span = 1;
  for (const s of Array.isArray(rec?.screenshots) ? rec.screenshots : []) {
    const n = Math.round(Number(s?.screenshot?.spanScreens) || 1);
    if (n > span) span = n;
  }
  return Math.max(base.width * span, base.height);
}

// ---------- Ingest settings ----------
// Images arriving through MCP (bulk import, set_screenshot_image, a tool seeding
// a project) used to be written to disk byte-for-byte as they came, which
// quietly undid the compression the browser applies to its own uploads. Ingest
// now applies the same policy. Tunable per deployment;
// APPSCREEN_IMAGE_COMPRESS=0 turns it off entirely.

export interface IngestSettings {
  enabled: boolean;
  quality: number;
  format: OptimizeFormat;
  maxEdge: number;
}

export function ingestSettings(): IngestSettings {
  const num = (v: string | undefined, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  return {
    enabled: process.env.APPSCREEN_IMAGE_COMPRESS !== "0",
    quality: Math.min(100, Math.max(1, num(process.env.APPSCREEN_IMAGE_QUALITY, DEFAULT_QUALITY))),
    format: process.env.APPSCREEN_IMAGE_FORMAT === "jpeg" ? "jpeg" : "webp",
    maxEdge: num(process.env.APPSCREEN_IMAGE_MAX_EDGE, MIN_LONG_EDGE),
  };
}

/**
 * Re-encode one image's bytes for storage. Returns null to mean "keep the
 * original" — unsupported format, nothing to gain, or a re-encode that came out
 * bigger. `maxEdge` of 0 disables resizing and only changes the codec.
 */
export async function compressImageBuffer(
  buf: Buffer,
  mime: string,
  opts: { quality: number; format: OptimizeFormat; maxEdge: number },
): Promise<{ bytes: Buffer<ArrayBuffer>; mime: string } | null> {
  const ext = (mime.split("/")[1] || "")
    .replace("jpeg", "jpg")
    .replace("svg+xml", "svg")
    .toLowerCase();
  if (UNTOUCHABLE.has(ext)) return null;
  let img;
  try { img = await loadImage(buf); } catch { return null; } // undecodable — store as-is
  const longest = Math.max(img.width, img.height);
  if (!longest) return null;
  const scale = opts.maxEdge > 0 && longest > opts.maxEdge ? opts.maxEdge / longest : 1;
  if (scale === 1 && ext === EXT_FOR[opts.format]) return null; // already how we'd store it
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  // Screenshots and background photos are opaque; flatten any alpha on white
  // rather than losing it to black in a format written without an alpha channel.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const bytes = Buffer.from(await canvas.encode(opts.format, opts.quality));
  if (bytes.length >= buf.length) return null;
  return { bytes, mime: opts.format === "jpeg" ? "image/jpeg" : "image/webp" };
}
