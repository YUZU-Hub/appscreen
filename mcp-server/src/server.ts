#!/usr/bin/env node
// appscreen MCP server — generates App Store screenshots server-side.
// Transports: stdio (default) and Streamable HTTP (--http / MCP_TRANSPORT=http).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import express from "express";
import { writeFile } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import {
  OUTPUT_SIZES,
  OUTPUT_DEVICES,
  GRADIENT_PRESET_CSS,
  GRADIENT_PRESET_NAMES,
  getPresetGradient,
} from "./presets.js";
import { renderScreenshot, type RenderSpec } from "./render.js";
import { putFile, getFile } from "./filestore.js";
import {
  listProjects,
  getProject,
  saveProject,
  mutateProject,
  withProjectLock,
  projectEvents,
  ConflictError,
  deleteProject,
  createProject,
  addScreenshot,
  setScreenshotImage,
  setScreenshotText,
  setScreenshotBackground,
  updateScreenshot,
  updateProjectSettings,
  removeScreenshot,
  reorderScreenshots,
  resolveImageToDataUrl,
  summarizeProject,
  putBlob,
  getBlob,
  missingBlobs,
  gcBlobs,
  readRev,
  verifyBlobRefs,
  listTombstones,
  checkStorePersistence,
  storeIsEphemeral,
  EPHEMERAL_STORE_MSG,
} from "./projectstore.js";
import { optimizeRecordImages, projectStorage } from "./imageopt.js";
import { outputPathFor, OUTPUT_DIR } from "./security.js";

// ---------- Zod schemas (shared by generate_screenshot and generate_batch) ----------

const gradientStop = z.object({
  color: z.string().describe("Hex color, e.g. #667eea"),
  position: z.number().min(0).max(100).describe("Stop position, 0-100"),
});

const background = z
  .object({
    type: z.enum(["gradient", "solid", "image"]).default("gradient"),
    preset: z
      .string()
      .optional()
      .describe(`Named gradient preset. One of: ${GRADIENT_PRESET_NAMES.join(", ")}`),
    gradientCss: z
      .string()
      .optional()
      .describe('Raw CSS, e.g. "linear-gradient(135deg, #667eea 0%, #764ba2 100%)"'),
    gradient: z
      .object({ angle: z.number(), stops: z.array(gradientStop).min(2) })
      .optional()
      .describe("Explicit gradient: angle in degrees + color stops"),
    solid: z.string().optional().describe("Solid hex color (type=solid)"),
    image: z
      .string()
      .optional()
      .describe("Background image: http(s) URL, appscreen-file:// ref (from POST /upload), data URL, raw base64, or a server file path (type=image)"),
    imageFit: z.enum(["cover", "contain", "stretch"]).optional(),
    imageBlur: z.number().min(0).optional(),
    overlayColor: z.string().optional(),
    overlayOpacity: z.number().min(0).max(100).optional(),
    noise: z.boolean().optional().describe("Add subtle noise texture"),
    noiseIntensity: z.number().min(0).max(100).optional(),
  })
  .describe("Background configuration");

const shadow = z.object({
  enabled: z.boolean().optional(),
  color: z.string().optional(),
  blur: z.number().optional(),
  opacity: z.number().min(0).max(100).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
});

const frame = z.object({
  enabled: z.boolean().optional(),
  color: z.string().optional(),
  width: z.number().optional(),
  opacity: z.number().min(0).max(100).optional(),
});

const screenshot = z
  .object({
    image: z
      .string()
      .optional()
      .describe("App screenshot: http(s) URL, appscreen-file:// ref (from POST /upload), data URL, raw base64, or a server file path"),
    scale: z.number().min(1).max(200).optional().describe("% of canvas width (default 70)"),
    x: z.number().min(0).max(100).optional().describe("Horizontal position, 50=center"),
    y: z.number().min(0).max(100).optional().describe("Vertical position (default 60)"),
    rotation: z.number().optional().describe("Rotation in degrees"),
    perspective: z.number().optional(),
    cornerRadius: z.number().min(0).optional().describe("Corner radius (default 24)"),
    shadow: shadow.optional(),
    frame: frame.optional(),
  })
  .describe("Device/screenshot placement");

const textStyle = z.object({
  text: z.string().optional(),
  texts: z
    .record(z.string())
    .optional()
    .describe('Per-language map, e.g. {"en":"Hi","fr":"Salut"}; selected by top-level `language`.'),
  enabled: z.boolean().optional(),
  font: z.string().optional(),
  size: z.number().optional(),
  weight: z.string().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
  color: z.string().optional(),
  opacity: z.number().min(0).max(100).optional(),
});

const text = z
  .object({
    position: z.enum(["top", "center", "bottom"]).optional(),
    offsetY: z.number().optional().describe("Distance from edge, in %"),
    lineHeight: z.number().optional(),
    headline: textStyle.optional(),
    subheadline: textStyle.optional(),
  })
  .describe("Headline / subheadline overlay");

const LAYERS = ["behind-screenshot", "above-screenshot", "above-text"] as const;

const element = z
  .object({
    type: z.enum(["text", "emoji", "icon", "graphic"]),
    layer: z.enum(LAYERS).optional().describe("Z-order layer (default above-text)"),
    x: z.number().min(0).max(100).optional().describe("Center X, % (default 50)"),
    y: z.number().min(0).max(100).optional().describe("Center Y, % (default 50)"),
    width: z.number().optional().describe("Width as % of canvas width"),
    rotation: z.number().optional(),
    opacity: z.number().min(0).max(100).optional(),
    // text
    text: z.string().optional(),
    texts: z.record(z.string()).optional().describe("Per-language text map"),
    font: z.string().optional(),
    fontSize: z.number().optional(),
    fontWeight: z.string().optional(),
    fontColor: z.string().optional(),
    italic: z.boolean().optional(),
    frame: z
      .string()
      .optional()
      .describe(
        "Text frame: none | laurel-simple | laurel-detailed | badge-circle | badge-ribbon (append -star for a star)",
      ),
    frameColor: z.string().optional(),
    frameScale: z.number().optional(),
    // emoji
    emoji: z.string().optional(),
    // icon / graphic
    image: z.string().optional().describe("Image: http(s) URL, appscreen-file:// ref, data URL, raw base64, or a server file path"),
    iconShadow: shadow.optional(),
  })
  .describe("A free-floating overlay element");

const popout = z
  .object({
    cropX: z.number().optional().describe("Crop origin X, % of screenshot (default 25)"),
    cropY: z.number().optional().describe("Crop origin Y, % (default 25)"),
    cropWidth: z.number().optional().describe("Crop width, % (default 30)"),
    cropHeight: z.number().optional().describe("Crop height, % (default 30)"),
    x: z.number().optional().describe("Display center X, % of canvas (default 70)"),
    y: z.number().optional().describe("Display center Y, % (default 30)"),
    width: z.number().optional().describe("Display width, % of canvas (default 30)"),
    rotation: z.number().optional(),
    opacity: z.number().min(0).max(100).optional(),
    cornerRadius: z.number().optional(),
    shadow: shadow.optional(),
    border: z
      .object({
        enabled: z.boolean().optional(),
        color: z.string().optional(),
        width: z.number().optional(),
        opacity: z.number().min(0).max(100).optional(),
      })
      .optional(),
  })
  .describe("A cropped zoom ('popout') of the main screenshot");

const renderShape = {
  outputDevice: z
    .enum(OUTPUT_DEVICES as [string, ...string[]])
    .optional()
    .describe("Named output size. Omit and pass width/height for custom."),
  width: z.number().optional(),
  height: z.number().optional(),
  language: z
    .string()
    .optional()
    .describe('Language key for `texts` maps (default "en").'),
  background,
  screenshot: screenshot.optional(),
  text: text.optional(),
  elements: z.array(element).optional().describe("Overlay elements (text/emoji/icon/graphic)"),
  popouts: z.array(popout).optional().describe("Cropped zoom callouts of the screenshot"),
  layout: z
    .object({
      avoidTextOverlap: z
        .boolean()
        .optional()
        .describe(
          "Constrain the screenshot so it never overlaps the headline/subheadline. It only moves/shrinks, never grows past the requested scale.",
        ),
      gap: z
        .number()
        .optional()
        .describe("Min gap between text and screenshot, as % of canvas height (default 3)."),
    })
    .optional()
    .describe("Automatic layout safeguards"),
  outputPath: z
    .string()
    .optional()
    .describe(
      `If set, also write the PNG to this file path on the server, confined to ${OUTPUT_DIR} (override with MCP_OUTPUT_DIR). Relative paths resolve inside it.`,
    ),
  deliver: z
    .enum(["inline", "url", "both"])
    .optional()
    .describe(
      "How to return the PNG: 'inline' base64 (default), 'url' = a temporary download link that auto-deletes after ttlSeconds (HTTP transport only), or 'both'.",
    ),
  ttlSeconds: z
    .number()
    .int()
    .min(10)
    .max(86400)
    .optional()
    .describe("Lifetime of the temporary download URL, in seconds (default 600 = 10 min)."),
};

// ---------- Delivery helper -----------

interface ServerCtx {
  publicBaseUrl?: string;
}

interface DeliveryOpts {
  deliver?: "inline" | "url" | "both";
  ttlSeconds?: number;
  outputPath?: string;
}

// Turn a rendered PNG into MCP content according to the requested delivery mode.
async function deliver(
  png: Buffer,
  width: number,
  height: number,
  opts: DeliveryOpts,
  ctx: ServerCtx,
): Promise<{ content: any[]; url?: string; savedTo?: string }> {
  const mode = opts.deliver ?? "inline";
  const content: any[] = [];
  const notes: string[] = [];

  let savedTo: string | undefined;
  if (opts.outputPath) {
    savedTo = await outputPathFor(opts.outputPath); // confined to MCP_OUTPUT_DIR
    await writeFile(savedTo, png);
  }

  let url: string | undefined;
  const wantUrl = mode === "url" || mode === "both";
  if (wantUrl && ctx.publicBaseUrl) {
    const ttlSec = Math.max(10, Math.min(opts.ttlSeconds ?? 600, 86400));
    const id = putFile(png, "image/png", ttlSec * 1000);
    url = `${ctx.publicBaseUrl}/files/${id}.png`;
    notes.push(`Download (expires in ${ttlSec}s): ${url}`);
  }
  const urlUnavailable = wantUrl && !ctx.publicBaseUrl;
  if (urlUnavailable) {
    notes.push("URL delivery needs the HTTP transport — returning the image inline instead.");
  }

  const wantInline = mode === "inline" || mode === "both" || urlUnavailable;
  if (wantInline) {
    content.push({ type: "image", data: png.toString("base64"), mimeType: "image/png" });
  }
  if (savedTo) notes.push(`Saved ${width}×${height} PNG to ${savedTo}`);
  if (notes.length) content.push({ type: "text", text: notes.join("\n") });

  return { content, url, savedTo };
}

// ---------- Build the MCP server ----------

function buildServer(ctx: ServerCtx = {}): McpServer {
  const server = new McpServer(
    {
      name: "appscreen-mcp",
      version: "1.0.0",
    },
    {
      // Surfaced to AI clients as the server's usage guide.
      instructions: [
        "App Store screenshot generator + persistent project store (shared with the appscreen web app:",
        "everything you change here appears live in the user's browser).",
        "",
        "TWO MODES:",
        "1. One-off rendering: generate_screenshot / generate_batch return finished PNGs without touching",
        "   any project. Helpers: list_output_sizes, list_gradient_presets.",
        "2. Project editing (persistent): list_projects → get_project (returns indices + EVERY current",
        "   setting) → mutate → the user finishes in the web app.",
        "",
        "PROJECT MODEL: a project has screenshots (ordered; referenced by index). Each screenshot holds",
        "per-language images (localizedImages) and texts (headlines/subheadlines keyed by language code),",
        "one background, device placement settings (under `screenshot`), text styling (under `text`),",
        "elements and popouts.",
        "",
        "WHICH TOOL: images → set_screenshot_image (one call per language). Text content →",
        "set_screenshot_text (accepts {lang:text} maps, all languages in one call). Background gradient/",
        "solid → set_screenshot_background (or `all:true` for every screenshot). ANY other parameter →",
        "update_screenshot (deep-merge patch: objects merge, arrays/scalars replace; e.g.",
        "{screenshot:{scale:80},text:{headlineSize:90}}). Project-level settings (outputDevice, languages,",
        "defaults, name) → update_project. Manage panels: add_screenshot, remove_screenshot,",
        "reorder_screenshots (indices shift after both — re-check with get_project).",
        "",
        "CONCURRENCY: writes are safe to run in parallel — the server serializes writes per project",
        "(different projects run concurrently). No need to throttle or sequence your calls.",
        "",
        "LANGUAGES: ISO codes ('en','fr','de','pt-br'…). Setting an image/text for a new language",
        "automatically adds it to projectLanguages.",
      ].join("\n"),
    },
  );

  // Make the efficient large-image path discoverable from the tool description.
  // Embeds this server's actual upload URL when known (HTTP transport).
  const uploadHint = ctx.publicBaseUrl
    ? ` IMAGE INPUTS: for a large image, do NOT inline base64. POST its raw bytes to ${ctx.publicBaseUrl}/upload (e.g. \`curl -X POST ${ctx.publicBaseUrl}/upload -H "Content-Type: image/png" --data-binary @shot.png\`), then pass the returned "appscreen-file://<id>" as the image field. A public http(s) URL also works (the server fetches it). Local file paths refer to the SERVER's disk, not yours.`
    : ` IMAGE INPUTS: pass images as a data URL, raw base64, an http(s) URL, an "appscreen-file://<id>" ref (POST raw bytes to /upload first), or a server file path.`;

  server.registerTool(
    "list_output_sizes",
    {
      annotations: { readOnlyHint: true },
      title: "List output sizes",
      description:
        "List all supported App Store / Play Store / web output sizes (device key → pixel dimensions).",
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text", text: JSON.stringify(OUTPUT_SIZES, null, 2) }],
    }),
  );

  server.registerTool(
    "list_gradient_presets",
    {
      annotations: { readOnlyHint: true },
      title: "List gradient presets",
      description:
        "List the 25 built-in gradient presets (name → CSS and parsed angle/stops).",
      inputSchema: {},
    },
    async () => {
      const out = GRADIENT_PRESET_NAMES.map((name) => ({
        name,
        css: GRADIENT_PRESET_CSS[name],
        ...getPresetGradient(name),
      }));
      return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
    },
  );

  server.registerTool(
    "generate_screenshot",
    {
      title: "Generate App Store screenshot",
      description:
        "Render a single marketing screenshot: background (gradient/preset/solid/image), " +
        "optional device screenshot with placement/shadow/border, and headline/subheadline text. " +
        "Returns the PNG inline (base64) by default, or as a temporary download URL (deliver='url')." +
        uploadHint,
      inputSchema: renderShape,
    },
    async (args) => {
      const { outputPath, deliver: deliverMode, ttlSeconds, ...spec } = args;
      const result = await renderScreenshot(spec as RenderSpec);
      const { content } = await deliver(
        result.png,
        result.width,
        result.height,
        { deliver: deliverMode, ttlSeconds, outputPath },
        ctx,
      );
      return { content };
    },
  );

  server.registerTool(
    "generate_batch",
    {
      title: "Generate a batch of screenshots",
      description:
        "Render multiple screenshots in one call. Each item is a full screenshot spec " +
        "(supports outputPath, deliver, ttlSeconds). Returns a per-item summary plus any " +
        "inline images / download URLs." +
        uploadHint,
      inputSchema: {
        screenshots: z
          .array(z.object(renderShape))
          .min(1)
          .max(50)
          .describe("Array of screenshot specs (same shape as generate_screenshot)."),
      },
    },
    async ({ screenshots }) => {
      const results: any[] = [];
      const images: any[] = [];
      for (let i = 0; i < screenshots.length; i++) {
        const { outputPath, deliver: deliverMode, ttlSeconds, ...spec } = screenshots[i] as any;
        try {
          const r = await renderScreenshot(spec as RenderSpec);
          const d = await deliver(
            r.png,
            r.width,
            r.height,
            { deliver: deliverMode, ttlSeconds, outputPath },
            ctx,
          );
          for (const c of d.content) if (c.type === "image") images.push(c);
          results.push({ index: i, ok: true, width: r.width, height: r.height, url: d.url, savedTo: d.savedTo });
        } catch (e: any) {
          results.push({ index: i, ok: false, error: String(e?.message ?? e) });
        }
      }
      return {
        content: [
          { type: "text", text: JSON.stringify(results, null, 2) },
          ...images,
        ],
      };
    },
  );

  // ---------- Project tools (see & modify on-disk projects) ----------
  // Projects are persisted on the server's disk (see projectstore.ts) and shared
  // with the web app via the REST endpoints below. These tools let an agent
  // browse projects, edit the screenshots' images per language, and update the
  // headline/subheadline text per language.

  const ok = (obj: any) => ({ content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] });

  server.registerTool(
    "list_projects",
    {
      annotations: { readOnlyHint: true },
      title: "List projects",
      description:
        "List all saved appscreen projects on the server's disk (id, name, screenshot count, languages).",
      inputSchema: {},
    },
    async () => ok(await listProjects()),
  );

  server.registerTool(
    "get_project",
    {
      annotations: { readOnlyHint: true },
      title: "Get a project",
      description:
        "Read one project. Returns a compact summary (screenshots, per-language images & texts) by " +
        "default; set includeImages=true to also get the raw inline image data URLs (can be large).",
      inputSchema: {
        id: z.string().describe("Project id (from list_projects)."),
        includeImages: z
          .boolean()
          .optional()
          .describe("Include full inline image data URLs in the response (default false)."),
      },
    },
    async ({ id, includeImages }) => {
      const rec = await getProject(id, { inline: !!includeImages });
      if (!rec) return { isError: true, content: [{ type: "text", text: `No project: ${id}` }] };
      return ok(includeImages ? rec : summarizeProject(rec));
    },
  );

  server.registerTool(
    "create_project",
    {
      title: "Create a project",
      description: "Create a new, empty project on disk. Returns the new project's id.",
      inputSchema: {
        name: z.string().describe("Display name for the project."),
        id: z.string().optional().describe("Optional explicit id (else auto-generated)."),
      },
    },
    async ({ name, id }) => {
      try {
        const rec = await createProject(name, id);
        return ok({ created: true, id: rec.id, name: rec.name });
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: String(e?.message ?? e) }] };
      }
    },
  );

  server.registerTool(
    "delete_project",
    {
      annotations: { destructiveHint: true },
      title: "Delete a project",
      description: "Permanently delete a project from disk.",
      inputSchema: { id: z.string().describe("Project id to delete.") },
    },
    async ({ id }) => ok({ deleted: await deleteProject(id), id }),
  );

  server.registerTool(
    "add_screenshot",
    {
      title: "Add a screenshot to a project",
      description:
        "Append a new screenshot panel to a project. Optionally seed it with an image for a language." +
        uploadHint,
      inputSchema: {
        projectId: z.string(),
        name: z.string().optional().describe("Screenshot label."),
        image: z.string().optional().describe("Optional image (any supported input form)."),
        language: z.string().optional().describe("Language for the image (default project's current, else 'en')."),
      },
    },
    async ({ projectId, name, image, language }) => {
      try {
        // Resolve the image outside the lock (network/IO), then mutate atomically.
        const dataUrl = image ? await resolveImageToDataUrl(image) : undefined;
        const { rec, result: index } = await mutateProject(projectId, (rec) =>
          addScreenshot(rec, { name, image: dataUrl, language }),
        );
        return ok({ projectId, index, screenshotCount: rec.screenshots.length });
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: String(e?.message ?? e) }] };
      }
    },
  );

  server.registerTool(
    "set_screenshot_image",
    {
      title: "Set a screenshot's image (per language)",
      description:
        "Replace/set the image of a screenshot in a project, for a given language. Works for every " +
        "language — call once per language, or build several screenshots' localized images." +
        uploadHint,
      inputSchema: {
        projectId: z.string(),
        index: z.number().int().min(0).describe("Screenshot index (from get_project)."),
        image: z.string().describe("Image to set (any supported input form)."),
        language: z.string().optional().describe("Language code, e.g. 'en','fr','de' (default project's current)."),
        name: z.string().optional().describe("Optional image file label."),
      },
    },
    async ({ projectId, index, image, language, name }) => {
      try {
        const dataUrl = await resolveImageToDataUrl(image); // outside the lock
        const { rec } = await mutateProject(projectId, (rec) =>
          setScreenshotImage(rec, index, dataUrl, { language, name }),
        );
        return ok({ projectId, index, language: language || rec.currentLanguage || "en", set: true });
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: String(e?.message ?? e) }] };
      }
    },
  );

  server.registerTool(
    "set_screenshot_text",
    {
      title: "Set a screenshot's headline / subheadline (per language)",
      description:
        "Update the headline and/or subheadline text of a screenshot. Pass a single string with a " +
        "`language` for one locale, or a `headlines`/`subheadlines` map to set many languages at once " +
        "(e.g. {\"en\":\"Hello\",\"fr\":\"Bonjour\"}). Supports every language.",
      inputSchema: {
        projectId: z.string(),
        index: z.number().int().min(0).describe("Screenshot index (from get_project)."),
        language: z.string().optional().describe("Target language for single-string headline/subheadline."),
        headline: z.string().optional().describe("Headline text for `language`."),
        subheadline: z.string().optional().describe("Subheadline text for `language`."),
        headlines: z.record(z.string()).optional().describe("Per-language headline map."),
        subheadlines: z.record(z.string()).optional().describe("Per-language subheadline map."),
      },
    },
    async ({ projectId, index, language, headline, subheadline, headlines, subheadlines }) => {
      try {
        const { rec } = await mutateProject(projectId, (rec) =>
          setScreenshotText(rec, index, { language, headline, subheadline, headlines, subheadlines }),
        );
        const s = rec.screenshots[index];
        return ok({ projectId, index, headlines: s.text?.headlines, subheadlines: s.text?.subheadlines });
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: String(e?.message ?? e) }] };
      }
    },
  );

  server.registerTool(
    "set_screenshot_background",
    {
      title: "Set a screenshot's background (gradient or solid)",
      description:
        "Set the background of a screenshot in a project. Pass a `gradient` (angle + color stops), a named " +
        "`preset`, or a `solid` hex color. Backgrounds are NOT per-language — one background per screenshot. " +
        "Use `all:true` (or omit `index`) to apply the same background to every screenshot, like the app's " +
        "\"Sync design to all screens\". Optional overlay/noise fields are merged in; other settings are kept.",
      inputSchema: {
        projectId: z.string(),
        index: z.number().int().min(0).optional().describe("Screenshot index (from get_project). Omit with all:true to apply to every screenshot."),
        all: z.boolean().optional().describe("Apply the same background to all screenshots."),
        type: z.enum(["gradient", "solid"]).optional().describe("Background type. Inferred from gradient/solid when omitted."),
        preset: z.string().optional().describe(`Named gradient preset. One of: ${GRADIENT_PRESET_NAMES.join(", ")}`),
        gradient: z
          .object({ angle: z.number(), stops: z.array(gradientStop).min(2) })
          .optional()
          .describe("Explicit gradient: angle in degrees + color stops [{color:'#30bdb4',position:0},…]."),
        solid: z.string().optional().describe("Solid hex color, e.g. #1a1a2e (sets type=solid)."),
        overlayColor: z.string().optional().describe("Optional overlay hex color."),
        overlayOpacity: z.number().min(0).max(100).optional().describe("Overlay opacity 0-100."),
        noise: z.boolean().optional().describe("Enable noise texture overlay."),
        noiseIntensity: z.number().min(0).max(100).optional().describe("Noise intensity 0-100."),
      },
    },
    async ({ projectId, index, all, type, preset, gradient, solid, overlayColor, overlayOpacity, noise, noiseIntensity }) => {
      try {
        if (index == null && !all) throw new Error("provide `index` (a screenshot) or `all:true`");
        const patch: Parameters<typeof setScreenshotBackground>[2] = {};
        if (solid != null) { patch.solid = solid; patch.type = type ?? "solid"; }
        const g = gradient ?? (preset ? getPresetGradient(preset) : undefined);
        if (g) { patch.gradient = g; patch.type = type ?? "gradient"; }
        if (type && !patch.type) patch.type = type;
        if (overlayColor != null) patch.overlayColor = overlayColor;
        if (overlayOpacity != null) patch.overlayOpacity = overlayOpacity;
        if (noise != null) patch.noise = noise;
        if (noiseIntensity != null) patch.noiseIntensity = noiseIntensity;
        if (Object.keys(patch).length === 0) throw new Error("nothing to set: pass preset, gradient, or solid");
        const { result: applied } = await mutateProject(projectId, (rec) =>
          setScreenshotBackground(rec, all ? "all" : (index as number), patch),
        );
        return ok({ projectId, applied, count: applied.length, type: patch.type ?? "gradient" });
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: String(e?.message ?? e) }] };
      }
    },
  );

  server.registerTool(
    "update_screenshot",
    {
      title: "Update ANY screenshot parameter (generic patch)",
      description:
        "Deep-merge a patch into a screenshot — every parameter the web app exposes is reachable. " +
        "Objects merge (only the fields you pass change); arrays and scalars replace. Use `all:true` to " +
        "patch every screenshot. Sections & example fields:\n" +
        "- screenshot (device placement): scale, x, y, rotation, perspective, cornerRadius, deviceModel2D " +
        "('iphone'|'ipad'|'samsung'|'mac'), deviceMacFinish ('silver'|'space-black'), bezelEnabled, spanScreens, use3D, device3D, rotation3D{x,y,z}, " +
        "shadow{enabled,color,blur,opacity,x,y}, frame{enabled,color,width,opacity,notch}\n" +
        "- text (styling/layout): headlineEnabled, headlineFont, headlineSize, headlineWeight, headlineColor, " +
        "headlineItalic/Underline/Strikethrough, headlineBgColor, headlineBgOpacity, position ('top'|'bottom'), " +
        "offsetY, lineHeight, subheadline* equivalents, subheadlineSpacing, subheadlineOpacity, perScreenText, " +
        "panelTexts[] (per-panorama-screen full text objects when perScreenText is on; legacy " +
        "panelHeadlines/panelSubheadlines still read as a fallback), perLanguageLayout, languageSettings{<lang>:{...}} " +
        "(for the TEXT CONTENT itself prefer set_screenshot_text)\n" +
        "- background: type, gradient{angle,stops}, solid, image (any supported input form — resolved " +
        "automatically), imageFit, imageBlur, overlayColor, overlayOpacity, noise, noiseIntensity\n" +
        "- top-level: name, deviceType, elements (array, replaces), popouts (array, replaces)\n" +
        "Inspect current values with get_project.",
      inputSchema: {
        projectId: z.string(),
        index: z.number().int().min(0).optional().describe("Screenshot index (from get_project). Omit with all:true."),
        all: z.boolean().optional().describe("Apply the patch to every screenshot."),
        patch: z.record(z.any()).describe("Partial screenshot object to deep-merge, e.g. {screenshot:{scale:80,rotation:5},text:{headlineSize:90}}."),
      },
    },
    async ({ projectId, index, all, patch }) => {
      try {
        if (index == null && !all) throw new Error("provide `index` or `all:true`");
        // Resolve a background image given in any input form (upload ref, URL, path)
        // outside the lock; data URLs are externalized to blobs on save.
        if (patch?.background?.image && typeof patch.background.image === "string") {
          patch.background.image = await resolveImageToDataUrl(patch.background.image);
        }
        const { result: applied } = await mutateProject(projectId, (rec) =>
          updateScreenshot(rec, all ? "all" : (index as number), patch),
        );
        return ok({ projectId, applied, count: applied.length, patchedKeys: Object.keys(patch || {}) });
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: String(e?.message ?? e) }] };
      }
    },
  );

  server.registerTool(
    "update_project",
    {
      title: "Update ANY project-level setting (generic patch)",
      description:
        "Deep-merge a patch into the project's top-level settings. Fields: name, outputDevice " +
        "(see list_output_sizes), customWidth, customHeight, currentLanguage, projectLanguages (array), " +
        "selectedIndex, defaults (the template applied to NEW screenshots — same shape as a screenshot's " +
        "background/screenshot/text sections). `id`, `rev` and `screenshots` are protected (use the " +
        "screenshot tools for those).",
      inputSchema: {
        projectId: z.string(),
        patch: z.record(z.any()).describe("Partial project object to deep-merge, e.g. {outputDevice:'ipad-13', projectLanguages:['en','fr','de']}."),
      },
    },
    async ({ projectId, patch }) => {
      try {
        const { rec, result: applied } = await mutateProject(projectId, (rec) =>
          updateProjectSettings(rec, patch),
        );
        return ok({ projectId, applied, name: rec.name, outputDevice: rec.outputDevice, languages: rec.projectLanguages });
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: String(e?.message ?? e) }] };
      }
    },
  );

  server.registerTool(
    "remove_screenshot",
    {
      annotations: { destructiveHint: true },
      title: "Remove a screenshot from a project",
      description: "Delete the screenshot at `index`. Remaining screenshots shift down (re-check indices with get_project).",
      inputSchema: {
        projectId: z.string(),
        index: z.number().int().min(0).describe("Screenshot index to remove (from get_project)."),
      },
    },
    async ({ projectId, index }) => {
      try {
        const { result: remaining } = await mutateProject(projectId, (rec) => removeScreenshot(rec, index));
        return ok({ projectId, removed: index, screenshotCount: remaining });
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: String(e?.message ?? e) }] };
      }
    },
  );

  server.registerTool(
    "reorder_screenshots",
    {
      title: "Reorder screenshots",
      description: "Move the screenshot at `from` to position `to` (other screenshots shift).",
      inputSchema: {
        projectId: z.string(),
        from: z.number().int().min(0).describe("Current index of the screenshot to move."),
        to: z.number().int().min(0).describe("Destination index."),
      },
    },
    async ({ projectId, from, to }) => {
      try {
        const { result: order } = await mutateProject(projectId, (rec) => reorderScreenshots(rec, from, to));
        return ok({ projectId, order });
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: String(e?.message ?? e) }] };
      }
    },
  );

  return server;
}

// ---------- Transport wiring ----------

async function runStdio() {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[appscreen-mcp] listening on stdio");
}

async function runHttp(port: number) {
  const app = express();

  // CORS so a browser (e.g. the appscreen web app's Settings → MCP connection)
  // can reach this server. MCP_CORS_ORIGIN is a comma-separated allowlist; the
  // default "*" reflects whatever Origin the request carries (no credentials are
  // used, so echoing the origin is safe and works for any deployment domain).
  const corsAllow = (process.env.MCP_CORS_ORIGIN || "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowAnyOrigin = corsAllow.includes("*");
  app.use((req, res, next) => {
    const reqOrigin = req.headers.origin;
    let allowOrigin: string;
    if (allowAnyOrigin) {
      allowOrigin = reqOrigin || "*"; // reflect the caller's origin when present
    } else if (reqOrigin && corsAllow.includes(reqOrigin)) {
      allowOrigin = reqOrigin;
    } else {
      allowOrigin = corsAllow[0]; // fall back to the first configured origin
    }
    res.header("Access-Control-Allow-Origin", allowOrigin);
    res.header("Vary", "Origin");
    // Includes PUT/DELETE for the project REST API (GET/PUT/DELETE /projects).
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      // If-Match carries the optimistic-concurrency rev on project PUTs — without
      // it here, every cross-origin save is blocked at the preflight.
      "Content-Type, Authorization, X-Auth-Token, Accept, If-Match, mcp-session-id, mcp-protocol-version, last-event-id",
    );
    res.header("Access-Control-Expose-Headers", "mcp-session-id");
    res.header("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Optional shared-token auth (MCP_AUTH_TOKEN). When set, every endpoint —
  // REST (projects, blobs, uploads, files) and the MCP endpoint — requires the
  // token via "Authorization: Bearer <token>" or an "X-Auth-Token" header.
  // GET /events (EventSource), GET /files/<id> (plain download links), and
  // GET blob endpoints (<img src> loads) can't send headers, so they also
  // accept "?token=". When unset, no auth (as before).
  // /health stays open for container healthchecks. Preflights are answered by
  // the CORS middleware above, before this runs.
  const authToken = process.env.MCP_AUTH_TOKEN || "";
  if (authToken) {
    const expected = Buffer.from(authToken);
    const matches = (t: unknown): boolean => {
      if (typeof t !== "string" || !t) return false;
      const got = Buffer.from(t);
      return got.length === expected.length && timingSafeEqual(got, expected);
    };
    app.use((req, res, next) => {
      if (/^\/(?:mcp\/)?health$/.test(req.path)) {
        next();
        return;
      }
      const auth = req.headers.authorization;
      const bearer = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : undefined;
      const queryOk =
        req.method === "GET" &&
        /\/(?:events|files\/[^/]+|projects\/[^/]+\/blobs\/[^/]+)$/.test(req.path) &&
        matches(req.query.token);
      if (matches(bearer) || matches(req.headers["x-auth-token"]) || queryOk) {
        next();
        return;
      }
      res.status(401).json({ error: "unauthorized" });
    });
  }

  // Public base URL used to build links. Prefer an explicit PUBLIC_BASE_URL
  // (correct behind proxies/tunnels); otherwise derive it from the request,
  // honoring X-Forwarded-* set by reverse proxies.
  const publicBaseUrlFor = (req: express.Request): string | undefined => {
    if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, "");
    const proto = String(req.headers["x-forwarded-proto"] || req.protocol).split(",")[0].trim();
    const host = String(req.headers["x-forwarded-host"] || req.get("host") || "").split(",")[0].trim();
    return host ? `${proto}://${host}` : undefined;
  };

  // Binary upload endpoint (raw image bytes — no base64). Must come before the
  // JSON parser so it isn't intercepted. Returns a reference to pass as an
  // `image` field, avoiding huge base64 in the MCP request.
  //
  // All non-MCP HTTP routes are mounted under BOTH "/" and "/mcp". Behind a
  // reverse proxy that only forwards "/mcp/*" to this server (e.g. the rest of
  // the domain serving the web app), the web app reaches the REST API at
  // "<host>/mcp/projects"; locally everything also works at the root.
  const HTTP_PREFIXES = ["", "/mcp"];

  const uploadHandler = (req: express.Request, res: express.Response) => {
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      res.status(400).json({ error: "empty body — POST the raw image bytes" });
      return;
    }
    const mime = (req.headers["content-type"] || "image/png").split(";")[0].trim();
    const ttlSec = Math.max(10, Math.min(parseInt(String(req.query.ttl || "3600"), 10) || 3600, 86400));
    const id = putFile(buf, mime, ttlSec * 1000);
    const ext = mime.split("/")[1]?.replace("jpeg", "jpg") || "png";
    const base = publicBaseUrlFor(req);
    res.json({
      id,
      ref: `appscreen-file://${id}`, // pass this as an `image` field (no round-trip)
      url: base ? `${base}/files/${id}.${ext}` : undefined,
      mime,
      bytes: buf.length,
      expiresIn: ttlSec,
    });
  };
  for (const p of HTTP_PREFIXES) {
    app.post(`${p}/upload`, express.raw({ type: "*/*", limit: "50mb" }), uploadHandler);
  }

  // Binary image-blob upload for the project store (content-addressed by name).
  // Raw bytes (no base64) so it stays small and fast; must precede express.json.
  const blobUploadHandler = async (req: express.Request, res: express.Response) => {
    try {
      if (storeIsEphemeral()) {
        res.status(507).json({ error: EPHEMERAL_STORE_MSG });
        return;
      }
      const buf = req.body as Buffer;
      if (!Buffer.isBuffer(buf) || buf.length === 0) {
        res.status(400).json({ error: "empty body — PUT the raw image bytes" });
        return;
      }
      await putBlob(req.params.name, buf);
      res.json({ ok: true, name: req.params.name, bytes: buf.length });
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message ?? e) });
    }
  };
  for (const p of HTTP_PREFIXES) {
    app.put(`${p}/projects/:id/blobs/:name`, express.raw({ type: "*/*", limit: "60mb" }), blobUploadHandler);
  }

  // BATCH image upload: many blobs in ONE request, so importing/saving a project
  // with hundreds of images costs a handful of round-trips instead of one per
  // image (a huge win over a tunnel). Binary framing (no base64 bloat):
  //   [uint32 BE headerLen][headerLen bytes JSON: [{name,size},…]][blob bytes…]
  // Each blob is content-addressed and verified exactly like the single PUT.
  const blobBatchHandler = async (req: express.Request, res: express.Response) => {
    try {
      if (storeIsEphemeral()) {
        res.status(507).json({ error: EPHEMERAL_STORE_MSG });
        return;
      }
      const buf = req.body as Buffer;
      if (!Buffer.isBuffer(buf) || buf.length < 4) {
        res.status(400).json({ error: "empty batch" });
        return;
      }
      const headerLen = buf.readUInt32BE(0);
      let off = 4;
      if (headerLen <= 0 || off + headerLen > buf.length) {
        res.status(400).json({ error: "bad batch header length" });
        return;
      }
      let header: Array<{ name: string; size: number }>;
      try {
        header = JSON.parse(buf.toString("utf8", off, off + headerLen));
        if (!Array.isArray(header)) throw new Error("not an array");
      } catch {
        res.status(400).json({ error: "bad batch header json" });
        return;
      }
      off += headerLen;
      const stored: string[] = [];
      const errors: Array<{ name: string; error: string }> = [];
      for (const ent of header) {
        const name = String(ent && ent.name);
        const size = ent && typeof ent.size === "number" ? ent.size : -1;
        if (size < 0 || off + size > buf.length) {
          errors.push({ name, error: "truncated batch entry" });
          break;
        }
        const data = Buffer.from(buf.subarray(off, off + size));
        off += size;
        try { await putBlob(name, data); stored.push(name); }
        catch (e: any) { errors.push({ name, error: String(e?.message ?? e) }); }
      }
      res.json({ ok: errors.length === 0, stored, errors });
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message ?? e) });
    }
  };
  for (const p of HTTP_PREFIXES) {
    app.post(`${p}/projects/:id/blobs/batch`, express.raw({ type: "*/*", limit: "110mb" }), blobBatchHandler);
  }

  app.use(express.json({ limit: "50mb" }));

  // Stateless: a fresh server+transport per request (simple and robust).
  app.post("/mcp", async (req, res) => {
    const server = buildServer({ publicBaseUrl: publicBaseUrlFor(req) });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error("[appscreen-mcp] request error:", e);
      if (!res.headersSent) res.status(500).json({ error: "internal error" });
    }
  });

  // Temporary download endpoints + project REST API, mounted under each prefix.
  const registerRestRoutes = (p: string) => {
    // Temporary download endpoint for deliver:'url'. Auto-expires (see filestore).
    app.get(`${p}/files/:id`, (req, res) => {
      const id = req.params.id.replace(/\.[a-z0-9]+$/i, "");
      const f = getFile(id);
      if (!f) {
        res.status(404).json({ error: "not found or expired" });
        return;
      }
      res.setHeader("Content-Type", f.mime);
      res.setHeader("Cache-Control", "no-store");
      res.send(f.buf);
    });

    // ---------- Project REST API (used by the web app to sync to disk) ----------
    // Same on-disk store the MCP project tools use, so the app and Claude share state.
    app.get(`${p}/projects`, async (_req, res) => {
      try {
        res.json(await listProjects());
      } catch (e: any) {
        res.status(500).json({ error: String(e?.message ?? e) });
      }
    });

    app.get(`${p}/projects/:id`, async (req, res) => {
      // Default inlines data URLs (back-compat). ?refs=1 returns the compact
      // refs record (disk-only mode: the app resolves blobs on demand).
      const inline = req.query.refs ? false : true;
      const rec = await getProject(req.params.id, { inline });
      if (!rec) {
        res.status(404).json({ error: "not found" });
        return;
      }
      res.json(rec);
    });

    // Serve a single image blob (content-addressed → safe to cache forever).
    // Used by the web app's "disk-only" mode: the browser keeps refs, not bytes.
    app.get(`${p}/projects/:id/blobs/:name`, async (req, res) => {
      const buf = await getBlob(req.params.name);
      if (!buf) {
        res.status(404).json({ error: "not found" });
        return;
      }
      const ext = (req.params.name.split(".").pop() || "png").toLowerCase();
      const mimes: Record<string, string> = {
        png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
        webp: "image/webp", gif: "image/gif", svg: "image/svg+xml", bmp: "image/bmp",
      };
      res.setHeader("Content-Type", mimes[ext] || "application/octet-stream");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.send(buf);
    });

    // Which of these image blobs does the server still need? The app uploads only
    // the missing ones (dedup across languages/projects/pushes).
    app.post(`${p}/projects/:id/blobs/check`, async (req, res) => {
      try {
        const names = Array.isArray(req.body?.names) ? req.body.names : [];
        res.json({ missing: await missingBlobs(names) });
      } catch (e: any) {
        res.status(400).json({ error: String(e?.message ?? e) });
      }
    });

    // How much disk this project's images take (deduplicated by blob, so images
    // shared across languages count once). Drives the "storage used" readout in
    // the app's settings.
    app.get(`${p}/projects/:id/storage`, async (req, res) => {
      try {
        const rec = await getProject(req.params.id);
        if (!rec) {
          res.status(404).json({ error: "not found" });
          return;
        }
        const s = await projectStorage(rec);
        res.json({ id: rec.id, name: rec.name || rec.id, screenshots: rec.screenshots?.length || 0, ...s });
      } catch (e: any) {
        res.status(500).json({ error: String(e?.message ?? e) });
      }
    });

    // Re-encode this project's stored images (smaller codec + no more pixels than
    // the output size can show) and repoint the record at the new blobs. The old
    // ones are left for the normal GC, which keeps any another project still uses.
    app.post(`${p}/projects/:id/optimize`, async (req, res) => {
      try {
        if (storeIsEphemeral()) {
          res.status(507).json({ error: EPHEMERAL_STORE_MSG });
          return;
        }
        const body = req.body || {};
        const opts = {
          quality: typeof body.quality === "number" ? body.quality : undefined,
          format: body.format === "jpeg" ? ("jpeg" as const) : ("webp" as const),
          maxEdge: typeof body.maxEdge === "number" ? body.maxEdge : undefined,
          keepResolution: body.keepResolution === true,
        };
        const out = await withProjectLock(req.params.id, async () => {
          const rec = await getProject(req.params.id);
          if (!rec) return null;
          const stats = await optimizeRecordImages(rec, opts);
          // Only write when something actually changed — an already-optimal
          // project shouldn't bump its rev and make every open tab reload.
          const saved = stats.rewritten > 0 ? await saveProject(rec) : rec;
          return { stats, rev: saved.rev ?? 0 };
        });
        if (!out) {
          res.status(404).json({ error: "not found" });
          return;
        }
        console.error(
          `[appscreen-mcp] optimize ${req.params.id}: ${out.stats.rewritten}/${out.stats.images} image(s) re-encoded, ` +
          `${(out.stats.beforeBytes / 1048576).toFixed(1)} MB → ${(out.stats.afterBytes / 1048576).toFixed(1)} MB`,
        );
        if (out.stats.rewritten) {
          gcBlobs()
            .then((r) => { if (r.deleted) console.error(`[appscreen-mcp] gc(after-optimize): removed ${r.deleted} blob(s), freed ${r.freedBytes} bytes`); })
            .catch((e) => console.error("[appscreen-mcp] gc(after-optimize) failed:", e));
        }
        res.json({ ok: true, id: req.params.id, rev: out.rev, ...out.stats });
      } catch (e: any) {
        res.status(500).json({ error: String(e?.message ?? e) });
      }
    });

    // Create or overwrite a project (the app PUTs its small refs record here). This
    // is also the migration path: a browser-only project is written on first sync.
    app.put(`${p}/projects/:id`, async (req, res) => {
      try {
        if (storeIsEphemeral()) {
          res.status(507).json({ error: EPHEMERAL_STORE_MSG });
          return;
        }
        const rec = { ...(req.body || {}), id: req.params.id };
        if (!Array.isArray(rec.screenshots)) {
          res.status(400).json({ error: "record needs a screenshots array" });
          return;
        }
        // Optimistic concurrency: the client sends the rev it based its edit on
        // (If-Match header, or `rev` in the body). A stale write is rejected with
        // 409 so a long-idle tab can't clobber data Claude/MCP pushed meanwhile.
        const hdr = req.get("If-Match");
        const baseRev =
          hdr != null && /^\d+$/.test(hdr) ? parseInt(hdr, 10)
          : typeof rec.rev === "number" ? rec.rev
          : undefined;
        // Serialize against concurrent MCP writes to the same project so the
        // rev-check read and the write can't interleave with another writer.
        const saved = await withProjectLock(rec.id, async () => {
          // A rev-less PUT may only CREATE. When the project already exists, a
          // full-document PUT without If-Match / body rev is a stale client
          // that would silently clobber newer data (the web app always sends
          // the rev for any project it pulled from the server) — reject it.
          if (baseRev == null) {
            const currentRev = await readRev(rec.id);
            if (currentRev != null) throw new ConflictError(currentRev);
          }
          return saveProject(rec, { baseRev });
        });
        // Verify every image the saved record references actually exists on disk
        // (restoring from the GC trash when possible). The client surfaces any
        // missing ones and re-uploads the bytes it still holds — a dangling
        // reference can never go silently unnoticed again.
        const verify = await verifyBlobRefs(saved);
        if (verify.missing.length) {
          console.warn(`[appscreen-mcp] project ${saved.id}: ${verify.missing.length}/${verify.total} referenced blob(s) missing:`, verify.missing.join(", "));
        }
        res.json({
          ok: true, id: saved.id, rev: saved.rev, updatedAt: saved.updatedAt,
          imageRefs: verify.total, missingRefs: verify.missing,
        });
      } catch (e: any) {
        if (e instanceof ConflictError) {
          res.status(409).json({ error: "conflict", rev: e.currentRev });
          return;
        }
        res.status(500).json({ error: String(e?.message ?? e) });
      }
    });

    app.delete(`${p}/projects/:id`, async (req, res) => {
      const ok = await deleteProject(req.params.id);
      // Reclaim any blobs the deleted project referenced (and nothing else does).
      if (ok) {
        gcBlobs()
          .then((r) => { if (r.deleted) console.error(`[appscreen-mcp] gc(after-delete): removed ${r.deleted} blob(s), freed ${r.freedBytes} bytes`); })
          .catch((e) => console.error("[appscreen-mcp] gc(after-delete) failed:", e));
      }
      res.json({ ok });
    });

    // Live updates: browsers subscribe here (EventSource) and get a "saved"/"deleted"
    // event the instant any project changes — whether the change came from MCP
    // (Claude) or another tab — so the UI updates without a manual refresh.
    app.get(`${p}/events`, (req, res) => {
      res.set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // disable proxy buffering (nginx) so events are instant
      });
      res.flushHeaders?.();
      res.write("retry: 3000\n");
      res.write("event: hello\ndata: {}\n\n");
      const send = (type: string) => (payload: unknown) => {
        try { res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`); } catch { /* client gone */ }
      };
      const onSaved = send("saved");
      const onDeleted = send("deleted");
      projectEvents.on("saved", onSaved);
      projectEvents.on("deleted", onDeleted);
      const keepAlive = setInterval(() => { try { res.write(": ka\n\n"); } catch { /* ignore */ } }, 25000);
      req.on("close", () => {
        clearInterval(keepAlive);
        projectEvents.off("saved", onSaved);
        projectEvents.off("deleted", onDeleted);
      });
    });

    // Authoritative deletions: ids of recently-deleted projects. The web app
    // checks this before migrating cache-only projects up, so a stale browser
    // cache can never resurrect a project deleted on the server.
    app.get(`${p}/tombstones`, async (_req, res) => {
      try {
        res.json({ ids: Object.keys(await listTombstones()) });
      } catch (e: any) {
        res.status(500).json({ error: String(e?.message ?? e) });
      }
    });

    app.get(`${p}/health`, (_req, res) => res.json({ ok: !storeIsEphemeral(), persistentStore: !storeIsEphemeral() }));
  };
  HTTP_PREFIXES.forEach(registerRestRoutes);

  app.listen(port, () => {
    console.error(`[appscreen-mcp] HTTP listening on http://localhost:${port}/mcp`);
  });

  // Refuse-writes guard: with REQUIRE_PERSISTENT_STORE=1 (the Docker image's
  // default), a store that is NOT on a mounted volume puts the server in
  // read-only mode — failing loudly beats silently accepting data that the
  // next redeploy would destroy.
  checkStorePersistence().catch(() => {});

  // Loud store report at startup: if this says "0 projects" on a server that had
  // data, the volume/path is wrong — fix the mount BEFORE anything writes.
  listProjects()
    .then((l) => console.error(
      `[appscreen-mcp] project store: ${process.env.APPSCREEN_PROJECTS_DIR || "(default ./projects)"} — ${l.length} project(s)${l.length ? ": " + l.map(p => p.id).join(", ") : " (EMPTY — wrong volume mount?)"}`,
    ))
    .catch((e) => console.error("[appscreen-mcp] project store unreadable:", e));

  // Periodic garbage collection of orphaned image blobs (every 6h), plus one run
  // shortly after startup. The grace period inside gcBlobs() protects blobs whose
  // project record hasn't been written yet, so this is always safe to run.
  const GC_INTERVAL_MS = 6 * 60 * 60 * 1000;
  const runGc = (tag: string) =>
    gcBlobs()
      .then((r) => { if (r.deleted) console.error(`[appscreen-mcp] gc(${tag}): removed ${r.deleted} blob(s), freed ${r.freedBytes} bytes`); })
      .catch((e) => console.error(`[appscreen-mcp] gc(${tag}) failed:`, e));
  setTimeout(() => runGc("startup"), 5 * 60 * 1000); // 5 min after boot
  setInterval(() => runGc("periodic"), GC_INTERVAL_MS).unref?.();
}

const useHttp =
  process.argv.includes("--http") || process.env.MCP_TRANSPORT === "http";
const port = parseInt(process.env.PORT || "3000", 10);

(useHttp ? runHttp(port) : runStdio()).catch((e) => {
  console.error("[appscreen-mcp] fatal:", e);
  process.exit(1);
});
