// Server-side port of appscreen's full 2D rendering pipeline (app.js).
// Layer order matches renderScreenshotToCanvas (app.js:7045):
//   background → noise → elements[behind-screenshot] → screenshot
//   → elements[above-screenshot] → popouts → text → elements[above-text]
//
// Uses @napi-rs/canvas, which mirrors the browser CanvasRenderingContext2D API
// (gradients, roundRect, shadows, filter blur, getImageData/putImageData, SVG).

import {
  createCanvas,
  loadImage,
  GlobalFonts,
  type Image,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import { readFile } from "node:fs/promises";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import type { Gradient } from "./presets.js";
import { OUTPUT_SIZES, getPresetGradient, parseGradient } from "./presets.js";
import { getFile as getUploadedFile } from "./filestore.js";
import { assertPublicUrl, imagePathFor } from "./security.js";

// ----- Spec types -----

export type Layer = "behind-screenshot" | "above-screenshot" | "above-text";

export interface BackgroundSpec {
  type: "gradient" | "solid" | "image";
  gradient?: Gradient;
  preset?: string;
  gradientCss?: string;
  solid?: string;
  image?: string;
  imageFit?: "cover" | "contain" | "stretch";
  imageBlur?: number;
  overlayColor?: string;
  overlayOpacity?: number;
  noise?: boolean;
  noiseIntensity?: number;
}

export interface ShadowSpec {
  enabled: boolean;
  color: string;
  blur: number;
  opacity: number;
  x: number;
  y: number;
}

export interface FrameSpec {
  enabled: boolean;
  color: string;
  width: number;
  opacity: number;
}

export interface ScreenshotSpec {
  image?: string;
  scale?: number;
  x?: number;
  y?: number;
  rotation?: number;
  perspective?: number;
  cornerRadius?: number;
  shadow?: Partial<ShadowSpec>;
  frame?: Partial<FrameSpec>;
}

export interface TextStyleSpec {
  text?: string;
  /** Per-language text map; selected by RenderSpec.language. Overrides `text`. */
  texts?: Record<string, string>;
  enabled?: boolean;
  font?: string;
  size?: number;
  weight?: string;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  color?: string;
  opacity?: number;
}

export interface TextSpec {
  position?: "top" | "center" | "bottom";
  offsetY?: number;
  lineHeight?: number;
  headline?: TextStyleSpec;
  subheadline?: TextStyleSpec;
}

/** A free-floating overlay element (app.js addElement family). */
export interface ElementSpec {
  type: "text" | "emoji" | "icon" | "graphic";
  layer?: Layer;
  x?: number; // % of canvas
  y?: number;
  width?: number; // % of canvas width
  rotation?: number;
  opacity?: number; // 0-100
  // text
  text?: string;
  texts?: Record<string, string>;
  font?: string;
  fontSize?: number;
  fontWeight?: string;
  fontColor?: string;
  italic?: boolean;
  frame?: string; // 'none' | laurel-* | badge-circle | badge-ribbon (+ '-star')
  frameColor?: string;
  frameScale?: number;
  // emoji
  emoji?: string;
  // icon / graphic
  image?: string;
  iconShadow?: Partial<ShadowSpec>;
}

/** A cropped "popout" zoom of the main screenshot (app.js addPopout). */
export interface PopoutSpec {
  cropX?: number;
  cropY?: number;
  cropWidth?: number;
  cropHeight?: number;
  x?: number;
  y?: number;
  width?: number;
  rotation?: number;
  opacity?: number;
  cornerRadius?: number;
  shadow?: Partial<ShadowSpec>;
  border?: { enabled?: boolean; color?: string; width?: number; opacity?: number };
}

export interface LayoutSpec {
  /** Constrain the screenshot so it never overlaps the headline/subheadline. */
  avoidTextOverlap?: boolean;
  /** Min gap between text block and screenshot, as % of canvas height (default 3). */
  gap?: number;
}

export interface RenderSpec {
  outputDevice?: string;
  width?: number;
  height?: number;
  /** Selects per-language text from `texts` maps (headline/subheadline/elements). */
  language?: string;
  background: BackgroundSpec;
  screenshot?: ScreenshotSpec;
  text?: TextSpec;
  elements?: ElementSpec[];
  popouts?: PopoutSpec[];
  layout?: LayoutSpec;
}

const DEFAULT_FONT = process.env.APPSCREEN_FONT_FAMILY || "sans-serif";

// Directory holding the laurel SVGs. Prefer the vendored copy under mcp-server/assets
// (self-contained, works in Docker); fall back to the repo's img/ folder. Override
// with APPSCREEN_ASSETS_DIR.
const ASSETS_DIR =
  process.env.APPSCREEN_ASSETS_DIR ||
  join(dirname(fileURLToPath(import.meta.url)), "..", "assets");

if (process.env.APPSCREEN_FONT_PATH) {
  for (const p of process.env.APPSCREEN_FONT_PATH.split(":").filter(Boolean)) {
    try {
      GlobalFonts.registerFromPath(p);
    } catch (e) {
      console.error(`[appscreen-mcp] failed to register font ${p}:`, e);
    }
  }
}

// ----- Image loading -----

// Accepts an image as: a data URL, an http(s) URL, an uploaded-file ref
// (appscreen-file://<id>, from POST /upload), raw base64, or a server file path.
// The URL / upload-ref forms avoid embedding huge base64 in the MCP request.
async function loadImageInput(input: string): Promise<Image> {
  // 1) data URL — data:image/png;base64,xxxx
  if (input.startsWith("data:")) {
    return loadImage(Buffer.from(input.slice(input.indexOf(",") + 1), "base64"));
  }
  // 2) Uploaded-file reference — resolved straight from the in-memory store (no HTTP).
  if (input.startsWith("appscreen-file://")) {
    const id = input.slice("appscreen-file://".length).replace(/\.[a-z0-9]+$/i, "");
    const f = getUploadedFile(id);
    if (!f) throw new Error(`appscreen-file not found or expired: ${id}`);
    return loadImage(f.buf);
  }
  // 3) http(s) URL — the server fetches the image.
  if (/^https?:\/\//i.test(input)) {
    await assertPublicUrl(input); // SSRF guard (see security.ts)
    const res = await fetch(input);
    if (!res.ok) throw new Error(`Failed to fetch image (HTTP ${res.status}): ${input}`);
    return loadImage(Buffer.from(await res.arrayBuffer()));
  }
  // 4) Raw base64. Base64 contains '/' and '+', so we can't rule it out by '/'.
  //    Detect by the magic prefix every common image format encodes to:
  //    PNG=iVBORw0KGgo, JPEG=/9j/, GIF=R0lGOD, WebP=UklGR, BMP=Qk, AVIF/HEIC=AAAA.
  const compact = input.replace(/\s+/g, "");
  if (/^(iVBORw0KGgo|\/9j\/|R0lGOD|UklGR|Qk[01]|AAAA)/.test(compact)) {
    return loadImage(Buffer.from(compact, "base64"));
  }
  // 5) Otherwise treat as a filesystem path — confined to MCP_IMAGE_DIR.
  return loadImage(await readFile(imagePathFor(input)));
}

const laurelCache = new Map<string, Image | null>();
const ASSET_FALLBACK_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "img");
async function loadLaurel(variant: string): Promise<Image | null> {
  if (laurelCache.has(variant)) return laurelCache.get(variant)!;
  let img: Image | null = null;
  const candidates = isAbsolute(variant)
    ? [variant]
    : [join(ASSETS_DIR, `${variant}.svg`), join(ASSET_FALLBACK_DIR, `${variant}.svg`)];
  for (const p of candidates) {
    try {
      img = await loadImage(await readFile(p));
      break;
    } catch {
      /* try next candidate */
    }
  }
  if (!img) console.error(`[appscreen-mcp] laurel asset not found: ${variant} (looked in ${candidates.join(", ")})`);
  laurelCache.set(variant, img);
  return img;
}

// ----- Language helper -----

function resolveText(
  obj: { text?: string; texts?: Record<string, string> } | undefined,
  language: string,
): string {
  if (!obj) return "";
  if (obj.texts) {
    return (
      obj.texts[language] ||
      obj.texts["en"] ||
      Object.values(obj.texts).find((v) => v) ||
      obj.text ||
      ""
    );
  }
  return obj.text || "";
}

// ----- Geometry helpers -----

function resolveDims(spec: RenderSpec): { width: number; height: number } {
  if (spec.outputDevice && spec.outputDevice !== "custom") {
    const s = OUTPUT_SIZES[spec.outputDevice];
    if (!s)
      throw new Error(
        `Unknown outputDevice "${spec.outputDevice}". Known: ${Object.keys(
          OUTPUT_SIZES,
        ).join(", ")} or "custom".`,
      );
    return { ...s };
  }
  if (!spec.width || !spec.height)
    throw new Error('Provide either "outputDevice" or both "width" and "height".');
  return { width: spec.width, height: spec.height };
}

function resolveGradient(bg: BackgroundSpec): Gradient {
  if (bg.gradient) return bg.gradient;
  if (bg.preset) return getPresetGradient(bg.preset);
  if (bg.gradientCss) return parseGradient(bg.gradientCss);
  return {
    angle: 135,
    stops: [
      { color: "#667eea", position: 0 },
      { color: "#764ba2", position: 100 },
    ],
  };
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function wrapText(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  // Break a token wider than maxWidth at the character level (long compound
  // words, or scripts without spaces such as CJK).
  const breakLongWord = (word: string, startLine: string): string => {
    let currentLine = startLine;
    for (const ch of word) {
      const test = currentLine + ch;
      if (ctx.measureText(test).width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = ch;
      } else {
        currentLine = test;
      }
    }
    return currentLine;
  };
  for (const rawLine of String(text).split(/\r?\n/)) {
    if (rawLine === "") {
      lines.push("");
      continue;
    }
    let currentLine = "";
    for (const word of rawLine.split(" ")) {
      if (ctx.measureText(word).width > maxWidth) {
        if (currentLine) { lines.push(currentLine); currentLine = ""; }
        currentLine = breakLongWord(word, "");
        continue;
      }
      const testLine = currentLine + (currentLine ? " " : "") + word;
      if (ctx.measureText(testLine).width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
  }
  return lines;
}

// ----- Background / noise -----

function drawBackground(
  ctx: SKRSContext2D,
  dims: { width: number; height: number },
  bg: BackgroundSpec,
  bgImage: Image | null,
) {
  if (bg.type === "gradient") {
    const g = resolveGradient(bg);
    const angle = (g.angle * Math.PI) / 180;
    const x1 = dims.width / 2 - Math.cos(angle) * dims.width;
    const y1 = dims.height / 2 - Math.sin(angle) * dims.height;
    const x2 = dims.width / 2 + Math.cos(angle) * dims.width;
    const y2 = dims.height / 2 + Math.sin(angle) * dims.height;
    const grad = ctx.createLinearGradient(x1, y1, x2, y2);
    for (const stop of g.stops) grad.addColorStop(stop.position / 100, stop.color);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, dims.width, dims.height);
  } else if (bg.type === "solid") {
    ctx.fillStyle = bg.solid || "#1a1a2e";
    ctx.fillRect(0, 0, dims.width, dims.height);
  } else if (bg.type === "image" && bgImage) {
    const img = bgImage;
    let sx = 0,
      sy = 0,
      sw = img.width,
      sh = img.height;
    let dx = 0,
      dy = 0,
      dw = dims.width,
      dh = dims.height;
    const fit = bg.imageFit || "cover";
    if (fit === "cover") {
      const imgRatio = img.width / img.height;
      const canvasRatio = dims.width / dims.height;
      if (imgRatio > canvasRatio) {
        sw = img.height * canvasRatio;
        sx = (img.width - sw) / 2;
      } else {
        sh = img.width / canvasRatio;
        sy = (img.height - sh) / 2;
      }
    } else if (fit === "contain") {
      const imgRatio = img.width / img.height;
      const canvasRatio = dims.width / dims.height;
      if (imgRatio > canvasRatio) {
        dh = dims.width / imgRatio;
        dy = (dims.height - dh) / 2;
      } else {
        dw = dims.height * imgRatio;
        dx = (dims.width - dw) / 2;
      }
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, dims.width, dims.height);
    }
    if (bg.imageBlur && bg.imageBlur > 0) ctx.filter = `blur(${bg.imageBlur}px)`;
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    ctx.filter = "none";
    if (bg.overlayOpacity && bg.overlayOpacity > 0) {
      ctx.fillStyle = bg.overlayColor || "#000000";
      ctx.globalAlpha = bg.overlayOpacity / 100;
      ctx.fillRect(0, 0, dims.width, dims.height);
      ctx.globalAlpha = 1;
    }
  }
}

function drawNoise(
  ctx: SKRSContext2D,
  dims: { width: number; height: number },
  intensity: number,
) {
  const imageData = ctx.getImageData(0, 0, dims.width, dims.height);
  const data = imageData.data;
  const noiseAmount = intensity / 100;
  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 255 * noiseAmount;
    data[i] = Math.max(0, Math.min(255, data[i] + noise));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
  }
  ctx.putImageData(imageData, 0, 0);
}

// ----- Screenshot -----

interface Box {
  imgWidth: number;
  imgHeight: number;
  x: number;
  y: number;
}

/** Compute the placement box exactly the way app.js drawScreenshotToContext does. */
function computeScreenshotBox(
  dims: { width: number; height: number },
  img: Image,
  s: ScreenshotSpec,
): Box {
  const scale = (s.scale ?? 70) / 100;
  let imgWidth = dims.width * scale;
  let imgHeight = (img.height / img.width) * imgWidth;
  if (imgHeight > dims.height * scale) {
    imgHeight = dims.height * scale;
    imgWidth = (img.width / img.height) * imgHeight;
  }
  const moveX = Math.max(dims.width - imgWidth, dims.width * 0.15);
  const moveY = Math.max(dims.height - imgHeight, dims.height * 0.15);
  const x = (dims.width - imgWidth) / 2 + ((s.x ?? 50) / 100 - 0.5) * moveX;
  const y = (dims.height - imgHeight) / 2 + ((s.y ?? 60) / 100 - 0.5) * moveY;
  return { imgWidth, imgHeight, x, y };
}

/**
 * Recompute the screenshot box so it sits entirely in the band left free by the
 * text block (with a gap), shrinking it only if necessary. The requested scale is
 * an upper bound — the screenshot never grows, it only moves down/up and/or scales
 * down to avoid overlapping the headline/subheadline.
 */
function fitScreenshotAroundText(
  ctx: SKRSContext2D,
  dims: { width: number; height: number },
  img: Image,
  s: ScreenshotSpec,
  txt: TextSpec,
  language: string,
  gapPct: number,
): Box {
  const box = computeScreenshotBox(dims, img, s);
  const extent = computeTextExtent(ctx, dims, txt, language);
  if (!extent) return box;

  const gap = dims.height * (gapPct / 100);
  const textAtTop = (txt.position ?? "top") === "top";

  // The free band the screenshot may occupy.
  const bandTop = textAtTop ? extent.bottom + gap : 0;
  const bandBottom = textAtTop ? dims.height : extent.top - gap;
  const bandHeight = bandBottom - bandTop;
  if (bandHeight <= 0) return box; // text fills the canvas; nothing we can do

  let { imgWidth, imgHeight } = box;

  // Shrink uniformly if the screenshot is taller than the band.
  if (imgHeight > bandHeight) {
    const factor = bandHeight / imgHeight;
    imgWidth *= factor;
    imgHeight *= factor;
  }

  // Horizontal position from the requested x, recomputed for the (maybe) new width.
  const moveX = Math.max(dims.width - imgWidth, dims.width * 0.15);
  const x = (dims.width - imgWidth) / 2 + ((s.x ?? 50) / 100 - 0.5) * moveX;

  // Keep the user's vertical bias where possible, but clamp into the band.
  let y = box.y;
  if (y < bandTop) y = bandTop;
  if (y + imgHeight > bandBottom) y = bandBottom - imgHeight;

  return { imgWidth, imgHeight, x, y };
}

function drawScreenshot(
  ctx: SKRSContext2D,
  dims: { width: number; height: number },
  img: Image,
  s: ScreenshotSpec,
  override?: Box,
) {
  const rotation = s.rotation ?? 0;
  const perspective = s.perspective ?? 0;
  const cornerRadius = s.cornerRadius ?? 24;

  const box = override ?? computeScreenshotBox(dims, img, s);
  const { imgWidth, imgHeight, x, y } = box;

  const centerX = x + imgWidth / 2;
  const centerY = y + imgHeight / 2;

  ctx.save();
  ctx.translate(centerX, centerY);
  if (rotation !== 0) ctx.rotate((rotation * Math.PI) / 180);
  if (perspective !== 0) ctx.transform(1, perspective * 0.01, 0, 1, 0, 0);
  ctx.translate(-centerX, -centerY);

  const radius = cornerRadius * (imgWidth / 400);

  const shadow = { enabled: true, color: "#000000", blur: 40, opacity: 30, x: 0, y: 20, ...s.shadow };
  if (shadow.enabled) {
    const shadowColor =
      shadow.color + Math.round((shadow.opacity / 100) * 255).toString(16).padStart(2, "0");
    ctx.shadowColor = shadowColor;
    ctx.shadowBlur = shadow.blur;
    ctx.shadowOffsetX = shadow.x;
    ctx.shadowOffsetY = shadow.y;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.roundRect(x, y, imgWidth, imgHeight, radius);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  ctx.beginPath();
  ctx.roundRect(x, y, imgWidth, imgHeight, radius);
  ctx.clip();
  ctx.drawImage(img, x, y, imgWidth, imgHeight);
  ctx.restore();

  const frame = { enabled: false, color: "#1d1d1f", width: 12, opacity: 100, ...s.frame };
  if (frame.enabled) {
    ctx.save();
    ctx.translate(centerX, centerY);
    if (rotation !== 0) ctx.rotate((rotation * Math.PI) / 180);
    if (perspective !== 0) ctx.transform(1, perspective * 0.01, 0, 1, 0, 0);
    ctx.translate(-centerX, -centerY);
    const frameWidth = frame.width * (imgWidth / 400);
    const frameRadius = cornerRadius * (imgWidth / 400) + frameWidth;
    ctx.globalAlpha = frame.opacity / 100;
    ctx.strokeStyle = frame.color;
    ctx.lineWidth = frameWidth;
    ctx.beginPath();
    ctx.roundRect(
      x - frameWidth / 2,
      y - frameWidth / 2,
      imgWidth + frameWidth,
      imgHeight + frameWidth,
      frameRadius,
    );
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

// ----- Text overlay (headline / subheadline) -----

/**
 * Measure the vertical extent {top, bottom} (canvas px) of the text block,
 * replaying drawText's exact layout maths without drawing. Returns null when
 * there is no visible text. Used by the avoid-overlap layout.
 */
function computeTextExtent(
  ctx: SKRSContext2D,
  dims: { width: number; height: number },
  txt: TextSpec,
  language: string,
): { top: number; bottom: number } | null {
  const position = txt.position ?? "top";
  const offsetY = txt.offsetY ?? 12;
  const lineHeightPct = txt.lineHeight ?? 110;
  const hl = txt.headline;
  const sl = txt.subheadline;
  const headline = hl && hl.enabled !== false ? resolveText(hl, language) : "";
  const subheadline = sl && sl.enabled === true ? resolveText(sl, language) : "";
  if (!headline && !subheadline) return null;

  const padding = dims.width * 0.08;
  const textY =
    position === "top"
      ? dims.height * (offsetY / 100)
      : dims.height * (1 - offsetY / 100);
  const isTop = position === "top";

  let top = Infinity;
  let bottom = -Infinity;
  let currentY = textY;

  if (headline) {
    const size = hl?.size ?? 100;
    ctx.font = `${hl?.italic ? "italic" : "normal"} ${hl?.weight ?? "600"} ${size}px ${hl?.font ?? DEFAULT_FONT}`;
    const lines = wrapText(ctx, headline, dims.width - padding * 2);
    const lineHeight = size * (lineHeightPct / 100);
    if (!isTop) currentY -= (lines.length - 1) * lineHeight;
    lines.forEach((_, i) => {
      const y = currentY + i * lineHeight;
      top = Math.min(top, isTop ? y : y - size);
      bottom = Math.max(bottom, isTop ? y + size : y);
    });
    const lastLineY = currentY + (lines.length - 1) * lineHeight;
    const gap = lineHeight - size;
    currentY = isTop ? lastLineY + size + gap : lastLineY + gap;
  }

  if (subheadline) {
    const size = sl?.size ?? 50;
    ctx.font = `${sl?.italic ? "italic" : "normal"} ${sl?.weight ?? "400"} ${size}px ${sl?.font ?? hl?.font ?? DEFAULT_FONT}`;
    const lines = wrapText(ctx, subheadline, dims.width - padding * 2);
    const subLineHeight = size * 1.4;
    lines.forEach((_, i) => {
      const y = currentY + i * subLineHeight; // baseline 'top' in both branches here
      top = Math.min(top, y);
      bottom = Math.max(bottom, y + size);
    });
  }

  if (!isFinite(top) || !isFinite(bottom)) return null;
  return { top, bottom };
}

function drawText(
  ctx: SKRSContext2D,
  dims: { width: number; height: number },
  txt: TextSpec,
  language: string,
) {
  const position = txt.position ?? "top";
  const offsetY = txt.offsetY ?? 12;
  const lineHeightPct = txt.lineHeight ?? 110;

  const hl = txt.headline;
  const sl = txt.subheadline;
  const headline = hl && hl.enabled !== false ? resolveText(hl, language) : "";
  const subheadline = sl && sl.enabled === true ? resolveText(sl, language) : "";
  if (!headline && !subheadline) return;

  const padding = dims.width * 0.08;
  const textY =
    position === "top"
      ? dims.height * (offsetY / 100)
      : dims.height * (1 - offsetY / 100);

  ctx.textAlign = "center";
  ctx.textBaseline = position === "top" ? "top" : "bottom";
  let currentY = textY;

  if (headline) {
    const size = hl?.size ?? 100;
    const weight = hl?.weight ?? "600";
    const font = hl?.font ?? DEFAULT_FONT;
    ctx.font = `${hl?.italic ? "italic" : "normal"} ${weight} ${size}px ${font}`;
    ctx.fillStyle = hl?.color ?? "#ffffff";

    const lines = wrapText(ctx, headline, dims.width - padding * 2);
    const lineHeight = size * (lineHeightPct / 100);
    if (position === "bottom") currentY -= (lines.length - 1) * lineHeight;

    let lastLineY = currentY;
    lines.forEach((line, i) => {
      const y = currentY + i * lineHeight;
      lastLineY = y;
      ctx.fillText(line, dims.width / 2, y);
      const textWidth = ctx.measureText(line).width;
      const lineThickness = Math.max(2, size * 0.05);
      const lx = dims.width / 2 - textWidth / 2;
      if (hl?.underline)
        ctx.fillRect(lx, position === "top" ? y + size * 0.9 : y + size * 0.1, textWidth, lineThickness);
      if (hl?.strikethrough)
        ctx.fillRect(lx, position === "top" ? y + size * 0.4 : y - size * 0.4, textWidth, lineThickness);
    });

    const gap = lineHeight - size;
    currentY = position === "top" ? lastLineY + size + gap : lastLineY + gap;
  }

  if (subheadline) {
    const size = sl?.size ?? 50;
    const weight = sl?.weight ?? "400";
    const font = sl?.font ?? hl?.font ?? DEFAULT_FONT;
    ctx.font = `${sl?.italic ? "italic" : "normal"} ${weight} ${size}px ${font}`;
    ctx.fillStyle = hexToRgba(sl?.color ?? "#ffffff", (sl?.opacity ?? 70) / 100);

    const lines = wrapText(ctx, subheadline, dims.width - padding * 2);
    const subLineHeight = size * 1.4;
    const subY = currentY;
    if (position === "bottom") ctx.textBaseline = "top";

    lines.forEach((line, i) => {
      const y = subY + i * subLineHeight;
      ctx.fillText(line, dims.width / 2, y);
      const textWidth = ctx.measureText(line).width;
      const lineThickness = Math.max(2, size * 0.05);
      const lx = dims.width / 2 - textWidth / 2;
      if (sl?.underline) ctx.fillRect(lx, y + size * 0.9, textWidth, lineThickness);
      if (sl?.strikethrough) ctx.fillRect(lx, y + size * 0.4, textWidth, lineThickness);
    });
    if (position === "bottom") ctx.textBaseline = "bottom";
  }
}

// ----- Elements -----

function drawStar(
  ctx: SKRSContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const outer = (i * 2 * Math.PI) / 5 - Math.PI / 2;
    const inner = outer + Math.PI / 5;
    const ox = cx + Math.cos(outer) * size;
    const oy = cy + Math.sin(outer) * size;
    const ix = cx + Math.cos(inner) * size * 0.4;
    const iy = cy + Math.sin(inner) * size * 0.4;
    if (i === 0) ctx.moveTo(ox, oy);
    else ctx.lineTo(ox, oy);
    ctx.lineTo(ix, iy);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawLaurel(
  ctx: SKRSContext2D,
  variant: string,
  w: number,
  h: number,
  scale: number,
  color: string,
  laurelImg: Image | null,
) {
  if (!laurelImg || !laurelImg.width) return;
  const branchH = h * 1.1 * scale;
  const aspect = laurelImg.width / laurelImg.height;
  const branchW = branchH * aspect;

  // Recolor the black SVG via a temp canvas (source-in composite).
  const tmp = createCanvas(Math.max(1, Math.ceil(branchW)), Math.max(1, Math.ceil(branchH)));
  const tctx = tmp.getContext("2d") as unknown as SKRSContext2D;
  tctx.drawImage(laurelImg, 0, 0, branchW, branchH);
  tctx.globalCompositeOperation = "source-in";
  tctx.fillStyle = color;
  tctx.fillRect(0, 0, branchW, branchH);

  const gap = 2 * scale;
  const leftX = -w / 2 - branchW - gap;
  const topY = -branchH / 2;
  ctx.drawImage(tmp as unknown as Image, leftX, topY, branchW, branchH);
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(tmp as unknown as Image, leftX, topY, branchW, branchH);
  ctx.restore();
}

function drawElementFrame(
  ctx: SKRSContext2D,
  el: ElementSpec,
  dims: { width: number; height: number },
  textHeight: number,
  laurelImg: Image | null,
) {
  const fontSize = el.fontSize ?? 60;
  const frame = el.frame || "none";
  const frameColor = el.frameColor ?? "#ffffff";
  const scale = (el.frameScale ?? 100) / 100;
  const padding = fontSize * 0.4 * scale;
  const elWidth = dims.width * ((el.width ?? 40) / 100);
  const lines = wrapText(ctx, resolveText(el, "en"), elWidth);
  const maxLineW = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const frameW = maxLineW + padding * 2;
  const frameH = textHeight + padding * 2;

  ctx.save();
  ctx.strokeStyle = frameColor;
  ctx.lineWidth = Math.max(2, fontSize * 0.04) * scale;

  const isLaurel = frame.startsWith("laurel-");
  const hasStar = frame.endsWith("-star");

  if (isLaurel) {
    const variant = frame.includes("detailed") ? "laurel-detailed-left" : "laurel-simple-left";
    drawLaurel(ctx, variant, frameW, frameH, scale, frameColor, laurelImg);
    if (hasStar)
      drawStar(ctx, 0, -frameH / 2 - fontSize * 0.2 * scale, fontSize * 0.3 * scale, frameColor);
  } else if (frame === "badge-circle") {
    ctx.beginPath();
    const radius = Math.max(frameW, frameH) / 2 + padding * 0.5;
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
  } else if (frame === "badge-ribbon") {
    const sw = frameW + padding;
    const sh = frameH + padding * 1.5;
    ctx.beginPath();
    ctx.moveTo(-sw / 2, -sh / 2);
    ctx.lineTo(sw / 2, -sh / 2);
    ctx.lineTo(sw / 2, sh / 2 - padding);
    ctx.lineTo(0, sh / 2);
    ctx.lineTo(-sw / 2, sh / 2 - padding);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

function drawElements(
  ctx: SKRSContext2D,
  dims: { width: number; height: number },
  elements: ElementSpec[],
  layer: Layer,
  language: string,
  resolved: Map<ElementSpec, Image | null>,
  laurels: Map<string, Image | null>,
) {
  for (const el of elements.filter((e) => (e.layer ?? "above-text") === layer)) {
    ctx.save();
    ctx.globalAlpha = (el.opacity ?? 100) / 100;
    const cx = dims.width * ((el.x ?? 50) / 100);
    const cy = dims.height * ((el.y ?? 50) / 100);
    const elWidth = dims.width * ((el.width ?? 20) / 100);
    ctx.translate(cx, cy);
    if (el.rotation) ctx.rotate((el.rotation * Math.PI) / 180);

    if (el.type === "emoji" && el.emoji) {
      const emojiSize = elWidth * 0.85;
      ctx.font = `${emojiSize}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(el.emoji, 0, 0);
    } else if (el.type === "icon" && resolved.get(el)) {
      const img = resolved.get(el)!;
      const sh = el.iconShadow ? { enabled: false, color: "#000000", blur: 20, opacity: 40, x: 0, y: 10, ...el.iconShadow } : null;
      if (sh?.enabled) {
        ctx.shadowColor = hexToRgba(sh.color, sh.opacity / 100);
        ctx.shadowBlur = sh.blur;
        ctx.shadowOffsetX = sh.x;
        ctx.shadowOffsetY = sh.y;
      }
      ctx.drawImage(img, -elWidth / 2, -elWidth / 2, elWidth, elWidth);
      if (sh?.enabled) {
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      }
    } else if (el.type === "graphic" && resolved.get(el)) {
      const img = resolved.get(el)!;
      const aspect = img.height / img.width;
      const elHeight = elWidth * aspect;
      ctx.drawImage(img, -elWidth / 2, -elHeight / 2, elWidth, elHeight);
    } else if (el.type === "text") {
      const elText = resolveText(el, language);
      if (elText) {
        const fontSize = el.fontSize ?? 60;
        ctx.font = `${el.italic ? "italic" : "normal"} ${el.fontWeight ?? "600"} ${fontSize}px ${el.font ?? DEFAULT_FONT}`;
        ctx.fillStyle = el.fontColor ?? "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const lines = wrapText(ctx, elText, elWidth);
        const lineHeight = fontSize * 1.05;
        const totalHeight = (lines.length - 1) * lineHeight + fontSize;
        if (el.frame && el.frame !== "none") {
          const variant = (el.frame.includes("detailed") ? "laurel-detailed-left" : "laurel-simple-left");
          drawElementFrame(ctx, el, dims, totalHeight, laurels.get(variant) ?? null);
        }
        const startY = -(totalHeight / 2) + fontSize / 2;
        lines.forEach((line, i) => ctx.fillText(line, 0, startY + i * lineHeight));
      }
    }
    ctx.restore();
  }
}

// ----- Popouts -----

function drawPopouts(
  ctx: SKRSContext2D,
  dims: { width: number; height: number },
  popouts: PopoutSpec[],
  img: Image,
) {
  for (const p of popouts) {
    ctx.save();
    ctx.globalAlpha = (p.opacity ?? 100) / 100;
    const sx = ((p.cropX ?? 25) / 100) * img.width;
    const sy = ((p.cropY ?? 25) / 100) * img.height;
    const sw = ((p.cropWidth ?? 30) / 100) * img.width;
    const sh = ((p.cropHeight ?? 30) / 100) * img.height;

    const displayW = dims.width * ((p.width ?? 30) / 100);
    const displayH = displayW * (sh / sw);
    const cx = dims.width * ((p.x ?? 70) / 100);
    const cy = dims.height * ((p.y ?? 30) / 100);

    ctx.translate(cx, cy);
    if (p.rotation) ctx.rotate((p.rotation * Math.PI) / 180);

    const halfW = displayW / 2;
    const halfH = displayH / 2;
    const radius = (p.cornerRadius ?? 12) * (displayW / 300);

    const shadow: ShadowSpec = {
      enabled: p.shadow ? p.shadow.enabled ?? true : false,
      color: "#000000",
      blur: 30,
      opacity: 40,
      x: 0,
      y: 15,
      ...p.shadow,
    };
    if (shadow.enabled) {
      ctx.shadowColor = hexToRgba(shadow.color, shadow.opacity / 100);
      ctx.shadowBlur = shadow.blur;
      ctx.shadowOffsetX = shadow.x;
      ctx.shadowOffsetY = shadow.y;
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.roundRect(-halfW, -halfH, displayW, displayH, radius);
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }

    const border = { enabled: true, color: "#ffffff", width: 3, opacity: 100, ...p.border };
    if (border.enabled) {
      const bw = border.width;
      ctx.save();
      ctx.globalAlpha = ((p.opacity ?? 100) / 100) * (border.opacity / 100);
      ctx.fillStyle = border.color;
      ctx.beginPath();
      ctx.roundRect(-halfW - bw, -halfH - bw, displayW + bw * 2, displayH + bw * 2, radius + bw);
      ctx.fill();
      ctx.restore();
    }

    ctx.beginPath();
    ctx.roundRect(-halfW, -halfH, displayW, displayH, radius);
    ctx.clip();
    ctx.drawImage(img, sx, sy, sw, sh, -halfW, -halfH, displayW, displayH);
    ctx.restore();
  }
}

// ----- Public entry point -----

export interface RenderResult {
  png: Buffer;
  width: number;
  height: number;
}

export async function renderScreenshot(spec: RenderSpec): Promise<RenderResult> {
  const dims = resolveDims(spec);
  const language = spec.language ?? "en";
  const canvas = createCanvas(dims.width, dims.height);
  const ctx = canvas.getContext("2d") as unknown as SKRSContext2D;

  // ----- Preload all images (canvas drawing is synchronous) -----
  const bgImage =
    spec.background.type === "image" && spec.background.image
      ? await loadImageInput(spec.background.image)
      : null;
  const shotImage = spec.screenshot?.image
    ? await loadImageInput(spec.screenshot.image)
    : null;

  const elements = spec.elements ?? [];
  const elementImages = new Map<ElementSpec, Image | null>();
  for (const el of elements) {
    if ((el.type === "icon" || el.type === "graphic") && el.image) {
      try {
        elementImages.set(el, await loadImageInput(el.image));
      } catch (e) {
        console.error("[appscreen-mcp] element image failed:", e);
        elementImages.set(el, null);
      }
    }
  }
  const laurels = new Map<string, Image | null>();
  for (const el of elements) {
    if (el.type === "text" && el.frame && el.frame.startsWith("laurel-")) {
      const variant = el.frame.includes("detailed") ? "laurel-detailed-left" : "laurel-simple-left";
      if (!laurels.has(variant)) laurels.set(variant, await loadLaurel(variant));
    }
  }

  // ----- Draw, in the app's exact layer order -----
  drawBackground(ctx, dims, spec.background, bgImage);
  if (spec.background.noise) drawNoise(ctx, dims, spec.background.noiseIntensity ?? 10);

  drawElements(ctx, dims, elements, "behind-screenshot", language, elementImages, laurels);

  // Constrain the screenshot so it never overlaps the text block, if requested.
  let shotOverride: Box | undefined;
  if (
    shotImage &&
    spec.screenshot &&
    spec.layout?.avoidTextOverlap &&
    spec.text
  ) {
    shotOverride = fitScreenshotAroundText(
      ctx,
      dims,
      shotImage,
      spec.screenshot,
      spec.text,
      language,
      spec.layout.gap ?? 3,
    );
  }

  if (shotImage && spec.screenshot)
    drawScreenshot(ctx, dims, shotImage, spec.screenshot, shotOverride);

  drawElements(ctx, dims, elements, "above-screenshot", language, elementImages, laurels);

  if (shotImage && spec.popouts && spec.popouts.length)
    drawPopouts(ctx, dims, spec.popouts, shotImage);

  if (spec.text) drawText(ctx, dims, spec.text, language);

  drawElements(ctx, dims, elements, "above-text", language, elementImages, laurels);

  return { png: canvas.toBuffer("image/png"), width: dims.width, height: dims.height };
}
