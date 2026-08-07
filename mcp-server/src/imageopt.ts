// Shrink the images a project keeps on disk.
//
// Screenshots arrive from the browser at whatever resolution the user captured
// them at — often far more pixels than the output canvas can ever show — and,
// for anything the app couldn't compress itself, as PNG. Both cost disk: one
// project translated into 40 languages easily reaches hundreds of megabytes.
//
// This module re-encodes each stored image to the smallest form that still
// renders pixel-for-pixel identically:
//   - downscaled to the largest size it can ever be drawn at (see targetScale),
//   - re-encoded as WebP (typically 30-50% under the JPEG the app writes today).
//
// Blobs are content-addressed, so a re-encode always produces a NEW blob: the
// bytes are written first, then the project record's refs are rewritten to point
// at them. The old blobs become unreferenced and the normal mark-and-sweep GC
// reclaims them — keeping any that another project still uses.
//
// NOTHING here is destructive beyond the re-encode itself: a re-encode that
// comes out bigger than the original is thrown away, and images that carry
// transparency (elements, popout graphics) are never touched.

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { createHash } from "node:crypto";
import {
  BLOB_REF_PREFIX,
  blobSize,
  getBlob,
  putBlob,
  type ProjectRecord,
} from "./projectstore.js";
import { OUTPUT_SIZES, type Size } from "./presets.js";

// Never downscale an image's longest edge below this, whatever the project's
// current output size says. The output device is a setting the user flips at
// any time (a project set to "web-og" today may export 6.9" screenshots
// tomorrow), and downscaling is the one irreversible step here — so the floor
// keeps every image big enough for the largest App Store output size
// (mac-2880 = 2880px, iphone-6.9 = 2868px) no matter what.
const MIN_LONG_EDGE = 2880;

// Below this gain, downscaling isn't worth the resample.
const RESIZE_EPSILON = 0.98;

const DEFAULT_QUALITY = 82;

export type OptimizeFormat = "webp" | "jpeg";

export interface OptimizeOptions {
  /** Encoder quality, 1-100 (default 82). */
  quality?: number;
  /** Target codec (default "webp"). */
  format?: OptimizeFormat;
  /** Extra hard cap on the longest edge, in pixels. 0/undefined = only the automatic cap. */
  maxEdge?: number;
  /** Re-encode only — never resample, whatever the render size says. */
  keepResolution?: boolean;
}

export interface OptimizeStats {
  /** Distinct image blobs the project references (excluding transparent artwork). */
  images: number;
  /** Blobs replaced by a smaller re-encode. */
  rewritten: number;
  /** Blobs already optimal (or whose re-encode came out bigger). */
  skipped: number;
  /** Blobs that could not be read or decoded — left exactly as they were. */
  failed: number;
  beforeBytes: number;
  afterBytes: number;
  savedBytes: number;
  errors: { name: string; error: string }[];
}

/** One place in the record that holds a ref, so it can be repointed after a re-encode. */
interface Site { obj: any; key: string | number }

/**
 * How an image is fitted when drawn, which decides how many source pixels it
 * actually needs:
 *  - "contain" (screenshots): drawn whole inside the canvas → the canvas box is
 *    an upper bound on its rendered size.
 *  - "cover" (background images): cropped to the canvas aspect, so the shorter
 *    axis is what has to reach the canvas.
 */
type Fit = "contain" | "cover";

interface Constraint {
  fit: Fit;
  canvasW: number;
  canvasH: number;
  /**
   * Popouts crop a slice of the screenshot and blow it up, so they can need MORE
   * source pixels than the full-frame draw. This is the source width, in pixels,
   * the most demanding popout requires across the whole image (0 = no popout).
   */
  popoutSourceW: number;
}

interface Use { name: string; sites: Site[]; constraints: Constraint[] }

const isRef = (v: unknown): v is string =>
  typeof v === "string" && v.startsWith(BLOB_REF_PREFIX);
const refName = (v: string) => v.slice(BLOB_REF_PREFIX.length);

/** The output canvas one screen of this project renders to (before panorama span). */
function baseCanvas(rec: ProjectRecord): Size {
  if (rec.outputDevice === "custom") {
    const width = Number(rec.customWidth) || 1290;
    const height = Number(rec.customHeight) || 2796;
    return { width, height };
  }
  return OUTPUT_SIZES[rec.outputDevice || "iphone-6.9"] || OUTPUT_SIZES["iphone-6.9"];
}

/**
 * Source width (in pixels of the full image) the screenshot's most demanding
 * popout needs. A popout showing `cropWidth`% of the image across `width`% of
 * the canvas magnifies it by canvasW*width / cropWidth — see drawPopoutsToContext
 * in app.js, which this mirrors.
 */
function popoutSourceWidth(shot: any, canvasW: number): number {
  const popouts = Array.isArray(shot?.popouts) ? shot.popouts : [];
  let needed = 0;
  for (const p of popouts) {
    const cropW = Number(p?.cropWidth);
    const dispW = Number(p?.width);
    if (!isFinite(cropW) || cropW <= 0 || !isFinite(dispW) || dispW <= 0) continue;
    needed = Math.max(needed, (canvasW * (dispW / 100)) / (cropW / 100));
  }
  return needed;
}

/**
 * Find every blob ref in the record, together with the render constraints that
 * apply where it sits. Subtrees holding transparent artwork (`elements`,
 * `popouts`) are skipped outright — flattening their alpha onto white would
 * visibly wreck them.
 */
function collectUses(rec: ProjectRecord): Map<string, Use> {
  const uses = new Map<string, Use>();
  const base = baseCanvas(rec);

  const add = (obj: any, key: string | number, name: string, c: Constraint) => {
    let use = uses.get(name);
    if (!use) { use = { name, sites: [], constraints: [] }; uses.set(name, use); }
    use.sites.push({ obj, key });
    use.constraints.push(c);
  };

  const handle = (obj: any, key: string | number, c: Constraint) => {
    const val = obj[key];
    if (typeof val === "string") {
      if (isRef(val)) add(obj, key, refName(val), c);
      return;
    }
    walk(val, c);
  };

  const walk = (node: any, c: Constraint) => {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) handle(node, i, c);
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const k of Object.keys(node)) {
      if (k === "elements" || k === "popouts") continue; // transparent artwork — hands off
      handle(node, k, k === "background" ? { ...c, fit: "cover" } : c);
    }
  };

  const shots = Array.isArray(rec.screenshots) ? rec.screenshots : [];
  for (const shot of shots) {
    // Panorama: a screen can span N output slots, so its canvas is N× as wide.
    const span = Math.max(1, Math.round(Number(shot?.screenshot?.spanScreens) || 1));
    const canvasW = base.width * span;
    walk(shot, {
      fit: "contain",
      canvasW,
      canvasH: base.height,
      popoutSourceW: popoutSourceWidth(shot, canvasW),
    });
  }
  // Everything else in the record (defaults.background.image, …).
  const rest: Constraint = { fit: "contain", canvasW: base.width, canvasH: base.height, popoutSourceW: 0 };
  for (const k of Object.keys(rec)) {
    if (k === "screenshots" || k === "elements" || k === "popouts") continue;
    handle(rec, k, k === "background" ? { ...rest, fit: "cover" } : rest);
  }
  return uses;
}

/**
 * How far this image may be scaled down (1 = keep as is). The result is the
 * LARGEST scale any of its uses demands — the same bytes are shared across
 * languages and screens, so the most demanding placement wins.
 */
function targetScale(use: Use, imgW: number, imgH: number, opts: OptimizeOptions): number {
  if (opts.keepResolution) return 1;
  if (!imgW || !imgH) return 1;
  let scale = 0;
  for (const c of use.constraints) {
    const fitScale = c.fit === "cover"
      ? Math.max(c.canvasW / imgW, c.canvasH / imgH)
      : Math.min(c.canvasW / imgW, c.canvasH / imgH);
    const popScale = c.popoutSourceW > 0 ? c.popoutSourceW / imgW : 0;
    scale = Math.max(scale, fitScale, popScale);
  }
  if (scale <= 0) scale = 1;
  // Safety floor: stay usable for the biggest output size the user could switch to.
  scale = Math.max(scale, MIN_LONG_EDGE / Math.max(imgW, imgH));
  // Explicit user cap, when asked for.
  if (opts.maxEdge && opts.maxEdge > 0) {
    scale = Math.min(scale, opts.maxEdge / Math.max(imgW, imgH));
  }
  scale = Math.min(1, scale);
  return scale > RESIZE_EPSILON ? 1 : scale;
}

const extOf = (name: string) => (name.split(".").pop() || "").toLowerCase();
const EXT_FOR: Record<OptimizeFormat, string> = { webp: "webp", jpeg: "jpg" };
// Formats we must never re-encode: vector (no pixels to resample) and animated
// (a canvas round-trip would keep the first frame only).
const UNTOUCHABLE = new Set(["svg", "gif"]);

/** Re-encode one image. Returns null when it should be left exactly as it is. */
async function reencode(
  buf: Buffer,
  name: string,
  use: Use,
  opts: OptimizeOptions,
): Promise<{ bytes: Buffer; ext: string } | null> {
  const format: OptimizeFormat = opts.format === "jpeg" ? "jpeg" : "webp";
  const quality = Math.min(100, Math.max(1, Math.round(opts.quality ?? DEFAULT_QUALITY)));
  const img = await loadImage(buf);
  const scale = targetScale(use, img.width, img.height, opts);
  // Already in the target codec at the right size: re-encoding would only add
  // another generation of lossy artefacts for no gain.
  if (scale === 1 && extOf(name) === EXT_FOR[format]) return null;

  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  // Both target codecs are opaque here (WebP could carry alpha, but these are
  // screenshots and background photos) — flatten on white like the browser does.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const bytes = Buffer.from(await canvas.encode(format, quality));
  // A re-encode that came out bigger is a re-encode we don't want.
  if (bytes.length >= buf.length) return null;
  return { bytes, ext: EXT_FOR[format] };
}

/** Bytes the project's images currently occupy on disk (deduplicated by blob). */
export async function projectStorage(
  rec: ProjectRecord,
): Promise<{ images: number; bytes: number; missing: number }> {
  const names = new Set<string>();
  const collect = (node: any) => {
    if (Array.isArray(node)) { node.forEach(collect); return; }
    if (node && typeof node === "object") { for (const k of Object.keys(node)) collect(node[k]); return; }
    if (isRef(node)) names.add(refName(node));
  };
  collect(rec);
  let bytes = 0;
  let missing = 0;
  for (const name of names) {
    const size = await blobSize(name);
    if (size == null) missing++; else bytes += size;
  }
  return { images: names.size, bytes, missing };
}

/**
 * Re-encode the project's stored images in place. MUTATES `rec` (its refs are
 * repointed at the new blobs) but does NOT save it — the caller owns the write,
 * so the whole thing can run inside the project's lock.
 */
export async function optimizeRecordImages(
  rec: ProjectRecord,
  opts: OptimizeOptions = {},
): Promise<OptimizeStats> {
  const uses = collectUses(rec);
  const stats: OptimizeStats = {
    images: 0, rewritten: 0, skipped: 0, failed: 0,
    beforeBytes: 0, afterBytes: 0, savedBytes: 0, errors: [],
  };

  for (const use of uses.values()) {
    if (UNTOUCHABLE.has(extOf(use.name))) continue;
    stats.images++;
    let before = 0;
    try {
      const buf = await getBlob(use.name);
      if (!buf) {
        // A ref whose bytes are gone: leave it alone and let the existing
        // missing-blob reporting deal with it.
        stats.failed++;
        stats.errors.push({ name: use.name, error: "blob not found" });
        continue;
      }
      before = buf.length;
      stats.beforeBytes += before;
      const out = await reencode(buf, use.name, use, opts);
      if (!out) {
        stats.skipped++;
        stats.afterBytes += before;
        continue;
      }
      const hash = createHash("sha256").update(out.bytes).digest("hex").slice(0, 40);
      const newName = `${hash}.${out.ext}`;
      // Bytes first, refs second: a crash in between leaves an unreferenced blob
      // (which GC reclaims), never a ref pointing at bytes that don't exist.
      await putBlob(newName, out.bytes);
      const newRef = BLOB_REF_PREFIX + newName;
      for (const site of use.sites) site.obj[site.key] = newRef;
      stats.rewritten++;
      stats.afterBytes += out.bytes.length;
    } catch (e: any) {
      stats.failed++;
      stats.afterBytes += before; // untouched — still on disk at its old size
      stats.errors.push({ name: use.name, error: String(e?.message ?? e) });
    }
  }
  stats.savedBytes = Math.max(0, stats.beforeBytes - stats.afterBytes);
  return stats;
}
