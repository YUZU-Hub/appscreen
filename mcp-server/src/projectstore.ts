// Persistent, on-disk project store for the appscreen MCP server.
//
// Projects used to live ONLY in the browser's IndexedDB. This module makes the
// project's *disk* the source of truth: each project is one JSON file under
// PROJECTS_DIR, in the exact shape the web app persists (see saveState() in
// app.js) plus a top-level `name` and `updatedAt`. Images are kept inline as
// data URLs so a record round-trips losslessly between the browser and disk.
//
// Both the MCP tools (for Claude) and the REST endpoints (for the web app)
// read/write through the helpers here, so the two stay in sync.

import { mkdir, readFile, readdir, writeFile, rm, stat, rename, utimes } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { getFile as getUploadedFile } from "./filestore.js";
import { assertPublicUrl, imagePathFor } from "./security.js";
import { compressImageBuffer, ingestSettings, recordRenderLongEdge } from "./imagecodec.js";

// Fires after every persisted change so transports can push live updates (the
// HTTP server relays these to browsers over SSE). "saved" → { id, rev };
// "deleted" → { id }. Bumped to allow many SSE listeners without warnings.
export const projectEvents = new EventEmitter();
projectEvents.setMaxListeners(0);

// ---------- Location on disk ----------

// Default: a `projects/` folder next to wherever the server is launched from
// (the repo root when started via .mcp.json). Override with APPSCREEN_PROJECTS_DIR.
export const PROJECTS_DIR = process.env.APPSCREEN_PROJECTS_DIR
  ? resolve(process.env.APPSCREEN_PROJECTS_DIR)
  : resolve(process.cwd(), "projects");

let dirReady = false;
async function ensureDir(): Promise<void> {
  if (dirReady) return;
  await mkdir(PROJECTS_DIR, { recursive: true });
  dirReady = true;
}

// ---------- Persistence guard ----------
// THE data-loss failure mode in production: the container runs WITHOUT a volume
// mounted at the project store, so every redeploy silently wipes all projects.
// With REQUIRE_PERSISTENT_STORE=1 (set in the Docker image; absent in dev) the
// server detects this — a mounted volume (bind or named) lives on a different
// device than the container's root overlay — and REFUSES writes loudly instead
// of accepting data into a store that the next redeploy will destroy.
let ephemeralStore = false;
export function storeIsEphemeral(): boolean { return ephemeralStore; }
export const EPHEMERAL_STORE_MSG =
  "STOCKAGE NON PERSISTANT: le dossier des projets n'est pas sur un volume monté — " +
  "toute donnée serait perdue au prochain redéploiement. Montez un volume sur " +
  "APPSCREEN_PROJECTS_DIR (voir docker-compose.prod.yml) puis redémarrez.";

export async function checkStorePersistence(): Promise<boolean> {
  if (process.env.REQUIRE_PERSISTENT_STORE !== "1") return true;
  try {
    await ensureDir();
    const dirStat = await stat(PROJECTS_DIR);
    const rootStat = await stat("/");
    ephemeralStore = dirStat.dev === rootStat.dev;
  } catch {
    ephemeralStore = false; // can't tell — don't block
  }
  if (ephemeralStore) {
    console.error(`[appscreen-mcp] FATAL: ${EPHEMERAL_STORE_MSG} (dir: ${PROJECTS_DIR})`);
  }
  return !ephemeralStore;
}

function assertWritableStore(): void {
  if (ephemeralStore) throw new Error(EPHEMERAL_STORE_MSG);
}

// ids come from the app (`default`, `project_<ts>`) or a tool. Keep them to a
// filesystem-safe charset so they can never escape PROJECTS_DIR.
function safeId(id: string): string {
  const clean = String(id || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!clean) throw new Error("invalid project id");
  return clean;
}

function fileFor(id: string): string {
  return join(PROJECTS_DIR, `${safeId(id)}.json`);
}

// ---------- Content-addressed image blob store ----------
// Images are stored once, by content hash, in a global `.blobs` dir (dedup across
// languages AND projects). Project files keep only refs ("appdisk://<hash>.<ext>"),
// so they stay tiny — the web app uploads image bytes separately as binary,
// avoiding the giant base64 JSON that hit body-size limits and was slow.

const BLOBS_DIR = join(PROJECTS_DIR, ".blobs");
const REF_PREFIX = "appdisk://";

let blobsReady = false;
async function ensureBlobsDir(): Promise<void> {
  if (blobsReady) return;
  await mkdir(BLOBS_DIR, { recursive: true });
  blobsReady = true;
}

function safeBlobName(name: string): string {
  const clean = String(name || "").replace(/[^a-zA-Z0-9_.-]/g, "");
  if (!clean || clean.includes("..")) throw new Error("invalid blob name");
  return clean;
}

const EXT_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  webp: "image/webp", gif: "image/gif", svg: "image/svg+xml", bmp: "image/bmp",
};
const mimeFromExt = (ext: string) => EXT_MIME[ext.toLowerCase()] || "application/octet-stream";
const extFromMime = (m: string) =>
  (m.split("/")[1] || "png").replace("jpeg", "jpg").replace("svg+xml", "svg");

export async function blobExists(name: string): Promise<boolean> {
  const safe = safeBlobName(name);
  try { await stat(join(BLOBS_DIR, safe)); return true; } catch { /* try the trash */ }
  // GC may have trashed it while unreferenced; someone is about to reference it
  // again (blobs/check before a push, PUT verification) — restore it.
  try {
    await rename(join(PROJECTS_DIR, ".blobs-trash", safe), join(BLOBS_DIR, safe));
    return true;
  } catch { return false; }
}
export async function putBlob(name: string, buf: Buffer): Promise<void> {
  assertWritableStore();
  await ensureBlobsDir();
  const clean = safeBlobName(name);
  // Blob names are content-addressed: the first 40 hex chars of the bytes'
  // sha-256 (see externalizeForUpload in app.js and externalizeRecord below).
  // Verify the name against the actual bytes so a client can't poison the
  // global dedup store by uploading arbitrary bytes under another image's name.
  const named = /^([0-9a-f]{40})\./.exec(clean);
  const hash = createHash("sha256").update(buf).digest("hex").slice(0, 40);
  if (!named || named[1] !== hash) {
    throw new Error(`blob name does not match content hash (expected ${hash}.<ext>)`);
  }
  const p = join(BLOBS_DIR, clean);
  // Content-addressed → if it already exists the bytes are identical; skip rewrite.
  if (!(await blobExists(clean))) await writeFile(p, buf);
}
export async function getBlob(name: string): Promise<Buffer | null> {
  const safe = safeBlobName(name);
  try { return await readFile(join(BLOBS_DIR, safe)); } catch { /* try trash below */ }
  // Resilience: if GC trashed this blob but a record referencing it came back
  // (restored cache, re-pushed project), restore it transparently from the trash.
  try {
    const inTrash = join(PROJECTS_DIR, ".blobs-trash", safe);
    const buf = await readFile(inTrash);
    try { await rename(inTrash, join(BLOBS_DIR, safe)); } catch { /* keep serving from trash */ }
    return buf;
  } catch { return null; }
}
/** Size on disk of a stored blob, or null when it isn't there. */
export async function blobSize(name: string): Promise<number | null> {
  try { return (await stat(join(BLOBS_DIR, safeBlobName(name)))).size; } catch { /* try the trash */ }
  try { return (await stat(join(PROJECTS_DIR, ".blobs-trash", safeBlobName(name)))).size; } catch { return null; }
}

/** The "appdisk://" scheme project records use to reference stored image blobs. */
export const BLOB_REF_PREFIX = REF_PREFIX;

/** Of the given blob names, return those NOT yet on disk (so the client only uploads new ones). */
export async function missingBlobs(names: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const n of names || []) { if (!(await blobExists(n))) out.push(n); }
  return out;
}

// ---------- Garbage collection of orphaned blobs ----------
// Blobs are content-addressed and shared across languages/screenshots/projects, so
// they are never deleted inline (a blob a user "deletes" in one place may still be
// referenced elsewhere). Instead, a mark-and-sweep reclaims blobs referenced by NO
// project. A grace period protects freshly-uploaded blobs whose project record
// hasn't been written yet (the upload→PUT window), so GC can run anytime safely.

const GC_GRACE_MS = 60 * 60 * 1000; // 1h
let gcRunning = false;

function collectRefs(obj: any, out: Set<string>): void {
  if (Array.isArray(obj)) {
    for (const v of obj) collectRefs(v, out);
  } else if (obj && typeof obj === "object") {
    for (const k of Object.keys(obj)) collectRefs(obj[k], out);
  } else if (typeof obj === "string" && obj.startsWith(REF_PREFIX)) {
    out.add(obj.slice(REF_PREFIX.length));
  }
}

export interface GcResult { deleted: number; freedBytes: number; kept: number; skippedYoung: number; aborted?: string }

// Soft-delete target: swept blobs go to a trash folder (restorable with a plain
// `mv`) and are only permanently purged after this retention period.
const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
function trashDir(): string { return join(PROJECTS_DIR, ".blobs-trash"); }

/**
 * Move blobs referenced by no project to the trash (purged for good after 7
 * days). SAFETY RAILS (each one aborts the sweep — losing disk space is always
 * better than losing images):
 *  - zero project files + a populated blob store = the store is almost certainly
 *    misconfigured or freshly mounted (wrong volume/path) → never sweep;
 *  - any project file that fails to parse → never sweep (its refs are invisible);
 *  - young blobs (grace period) are skipped, as before.
 */
export async function gcBlobs(opts: { graceMs?: number } = {}): Promise<GcResult> {
  const empty: GcResult = { deleted: 0, freedBytes: 0, kept: 0, skippedYoung: 0 };
  if (gcRunning) return empty; // never overlap two sweeps
  gcRunning = true;
  try {
    await ensureDir();
    await ensureBlobsDir();
    // Mark: every blob name referenced by any project on disk.
    const referenced = new Set<string>();
    const files = (await readdir(PROJECTS_DIR)).filter((f) => f.endsWith(".json") && !f.startsWith("."));
    let blobFiles: string[] = [];
    try { blobFiles = await readdir(BLOBS_DIR); } catch { blobFiles = []; }
    if (files.length === 0 && blobFiles.length > 0) {
      return { ...empty, aborted: "no project files but blob store is populated — store looks misconfigured, refusing to sweep" };
    }
    for (const f of files) {
      try { collectRefs(JSON.parse(await readFile(join(PROJECTS_DIR, f), "utf8")), referenced); }
      catch (e) {
        // An unreadable project may reference blobs we can't see — sweeping now
        // could delete data that's still in use. Abort this entire GC run.
        console.warn(`[appscreen-mcp] gc: cannot read/parse ${join(PROJECTS_DIR, f)} — aborting sweep:`, e);
        return { ...empty, aborted: `unreadable project file ${f} — refusing to sweep` };
      }
    }
    // Sweep: MOVE unreferenced blobs (past the grace period) to the trash.
    const res: GcResult = { deleted: 0, freedBytes: 0, kept: 0, skippedYoung: 0 };
    const now = Date.now();
    const grace = opts.graceMs ?? GC_GRACE_MS;
    await mkdir(trashDir(), { recursive: true });
    for (const name of blobFiles) {
      if (referenced.has(name)) { res.kept++; continue; }
      const full = join(BLOBS_DIR, name);
      try {
        const st = await stat(full);
        if (now - st.mtimeMs < grace) { res.skippedYoung++; continue; } // may be mid-upload
        const trashed = join(trashDir(), name);
        await rename(full, trashed); // soft delete — recoverable
        // Stamp the TRASHED-AT time (rename keeps the old mtime, which would make
        // retention count from the upload date and purge old blobs immediately).
        const t = new Date();
        try { await utimes(trashed, t, t); } catch { /* best effort */ }
        res.deleted++;
        res.freedBytes += st.size;
      } catch { /* file vanished or unreadable — ignore */ }
    }
    // Purge trash entries past retention — but if a trashed blob became
    // referenced again (record restored), move it BACK instead of purging.
    try {
      for (const name of await readdir(trashDir())) {
        const full = join(trashDir(), name);
        try {
          if (referenced.has(name)) { await rename(full, join(BLOBS_DIR, name)); continue; }
          const st = await stat(full);
          if (now - st.mtimeMs > TRASH_RETENTION_MS) await rm(full);
        } catch { /* ignore per-file errors */ }
      }
    } catch { /* no trash dir — fine */ }
    return res;
  } finally {
    gcRunning = false;
  }
}

/**
 * Verify that every blob a record references actually exists on disk (restoring
 * from the GC trash when needed). Returned `missing` names are images the server
 * CANNOT serve — the client surfaces them and re-uploads any bytes it still has.
 * Runs after each save so a dangling reference can never go unnoticed.
 */
export async function verifyBlobRefs(rec: ProjectRecord): Promise<{ total: number; missing: string[] }> {
  const refs = new Set<string>();
  collectRefs(rec, refs);
  const missing: string[] = [];
  for (const name of refs) {
    if (!(await blobExists(name))) missing.push(name); // blobExists restores from trash
  }
  return { total: refs.size, missing };
}

// ---------- Tombstones (authoritative deletions) ----------
// The server is the source of truth: when a project is deleted here, a browser
// whose cache still holds it must NOT "migrate" it back up on its next sync.
// Deletions are recorded in .tombstones.json (30-day retention); the client
// checks GET /tombstones before migrating cache-only projects. An explicit
// create/save of the same id revives it (clears the tombstone).

const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const tombstonesFile = () => join(PROJECTS_DIR, ".tombstones.json");

// Tiny mutex: tombstone read-modify-writes from different projects must not race.
let _tombChain: Promise<unknown> = Promise.resolve();
function withTombLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = _tombChain.then(fn, fn);
  _tombChain = run.then(() => {}, () => {});
  return run;
}

export async function listTombstones(): Promise<Record<string, string>> {
  try { return JSON.parse(await readFile(tombstonesFile(), "utf8")) || {}; } catch { return {}; }
}

async function writeTombstones(t: Record<string, string>): Promise<void> {
  const tmp = tombstonesFile() + ".tmp";
  await writeFile(tmp, JSON.stringify(t));
  await rename(tmp, tombstonesFile());
}

function addTombstone(id: string): Promise<void> {
  return withTombLock(async () => {
    const t = await listTombstones();
    const now = Date.now();
    for (const k of Object.keys(t)) {
      const ts = Date.parse(t[k]);
      if (!isFinite(ts) || now - ts > TOMBSTONE_RETENTION_MS) delete t[k];
    }
    t[safeId(id)] = new Date().toISOString();
    await writeTombstones(t);
  });
}

function clearTombstone(id: string): Promise<void> {
  return withTombLock(async () => {
    const t = await listTombstones();
    if (t[safeId(id)] === undefined) return;
    delete t[safeId(id)];
    await writeTombstones(t);
  });
}

const isRef = (v: unknown): v is string => typeof v === "string" && v.startsWith(REF_PREFIX);

async function walkStrings(obj: any, fn: (v: any) => Promise<any>): Promise<void> {
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) obj[i] = await visit(obj[i], fn);
  } else if (obj && typeof obj === "object") {
    for (const k of Object.keys(obj)) obj[k] = await visit(obj[k], fn);
  }
}
async function visit(v: any, fn: (v: any) => Promise<any>): Promise<any> {
  const mapped = await fn(v);
  if (mapped !== v) return mapped;
  if (v && typeof v === "object") await walkStrings(v, fn);
  return v;
}

/**
 * Store one image's bytes as a content-addressed blob and return its
 * "appdisk://<hash>.<ext>" ref.
 *
 * Unless `keepFormat` is set, the bytes are compressed on the way in with the
 * same policy the browser applies to its own uploads (see imagecodec.ts) — MCP
 * callers used to be the one path that wrote raw multi-megabyte PNGs to disk.
 * `maxEdge` must already account for what the project renders; pass 0 to
 * re-encode without resizing.
 */
export async function storeImageAsBlob(
  dataUrl: string,
  opts: { keepFormat?: boolean; maxEdge?: number } = {},
): Promise<string> {
  await ensureBlobsDir();
  const comma = dataUrl.indexOf(",");
  const header = dataUrl.slice(5, comma);
  let mime = header.split(";")[0] || "image/png";
  let buf = Buffer.from(dataUrl.slice(comma + 1), /;base64/i.test(header) ? "base64" : "utf8");
  // Element / popout artwork can be a transparent PNG — flattening it onto white
  // would visibly wreck it, so those are stored exactly as they arrived.
  if (!opts.keepFormat) {
    const cfg = ingestSettings();
    if (cfg.enabled) {
      const out = await compressImageBuffer(buf, mime, {
        quality: cfg.quality,
        format: cfg.format,
        maxEdge: opts.maxEdge ?? cfg.maxEdge,
      });
      if (out) { buf = out.bytes; mime = out.mime; }
    }
  }
  const hash = createHash("sha256").update(buf).digest("hex").slice(0, 40);
  const name = `${hash}.${extFromMime(mime)}`;
  await putBlob(name, buf);
  return REF_PREFIX + name;
}

// Replace inline data:image URLs with refs, writing each unique image to the blob
// store. Leaves existing refs untouched. Used by saveProject so MCP-tool data URLs
// are externalized too.
//
// The walk carries one bit of context — whether we are inside an `elements` /
// `popouts` subtree — because those hold transparent artwork that must keep its
// format, while screenshots and backgrounds get compressed.
async function externalizeRecord(rec: ProjectRecord): Promise<void> {
  await ensureBlobsDir();
  const cfg = ingestSettings();
  // Never cap below what this project actually draws (panorama span, custom
  // output size); the floor in ingestSettings only adds headroom on top.
  const maxEdge = cfg.enabled ? Math.max(cfg.maxEdge, recordRenderLongEdge(rec)) : 0;
  const seen = new Map<string, string>(); // data URL -> ref (dedup within one save)

  const handle = async (val: any, keepFormat: boolean): Promise<any> => {
    if (typeof val !== "string" || !val.startsWith("data:image/")) return val;
    const key = (keepFormat ? "k:" : "c:") + val;
    const hit = seen.get(key);
    if (hit) return hit;
    const ref = await storeImageAsBlob(val, { keepFormat, maxEdge });
    seen.set(key, ref);
    return ref;
  };

  const walk = async (node: any, keepFormat: boolean): Promise<void> => {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const mapped = await handle(node[i], keepFormat);
        if (mapped !== node[i]) node[i] = mapped;
        else if (node[i] && typeof node[i] === "object") await walk(node[i], keepFormat);
      }
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const k of Object.keys(node)) {
      const childKeep = keepFormat || k === "elements" || k === "popouts";
      const mapped = await handle(node[k], childKeep);
      if (mapped !== node[k]) node[k] = mapped;
      else if (node[k] && typeof node[k] === "object") await walk(node[k], childKeep);
    }
  };
  await walk(rec, false);
}

// Inverse: replace refs with reconstructed data URLs (for the browser, which
// expects data URLs in screenshot.src / localizedImages[].src).
async function inlineRecord(rec: ProjectRecord): Promise<void> {
  await walkStrings(rec, async (v) => {
    if (isRef(v)) {
      const name = v.slice(REF_PREFIX.length);
      const buf = await getBlob(name);
      if (!buf) return v; // missing blob — leave the ref rather than corrupt
      const ext = (name.split(".").pop() || "png").toLowerCase();
      return `data:${mimeFromExt(ext)};base64,${buf.toString("base64")}`;
    }
    return v;
  });
}


// ---------- Record shape (mirrors the web app's persisted project) ----------

export interface ProjectRecord {
  id: string;
  name?: string;
  formatVersion?: number;
  screenshots: any[];
  selectedIndex?: number;
  outputDevice?: string;
  customWidth?: number;
  customHeight?: number;
  currentLanguage?: string;
  projectLanguages?: string[];
  defaults?: any;
  updatedAt?: string;
  rev?: number;
  [k: string]: any;
}

/** Thrown by saveProject when a write's base revision is older than what's on disk. */
export class ConflictError extends Error {
  currentRev: number;
  constructor(currentRev: number) {
    super(`conflict: project was modified by someone else (current rev ${currentRev})`);
    this.name = "ConflictError";
    this.currentRev = currentRev;
  }
}

// ---------- CRUD ----------

export async function listProjects(): Promise<
  { id: string; name: string; screenshotCount: number; languages: string[]; updatedAt?: string; rev: number }[]
> {
  await ensureDir();
  const files = (await readdir(PROJECTS_DIR)).filter((f) => f.endsWith(".json") && !f.startsWith("."));
  const out = [];
  for (const f of files) {
    try {
      const rec = JSON.parse(await readFile(join(PROJECTS_DIR, f), "utf8")) as ProjectRecord;
      out.push({
        id: rec.id || f.replace(/\.json$/, ""),
        name: rec.name || rec.id || f.replace(/\.json$/, ""),
        screenshotCount: Array.isArray(rec.screenshots) ? rec.screenshots.length : 0,
        languages: rec.projectLanguages || ["en"],
        updatedAt: rec.updatedAt,
        rev: typeof rec.rev === "number" ? rec.rev : 0,
      });
    } catch (e) {
      console.warn(`[appscreen-mcp] skipping unreadable project file ${join(PROJECTS_DIR, f)}:`, e);
    }
  }
  out.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  return out;
}

export async function getProject(
  id: string,
  opts: { inline?: boolean } = {},
): Promise<ProjectRecord | null> {
  await ensureDir();
  const path = fileFor(id);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (e: any) {
    if (e?.code !== "ENOENT") console.error(`[appscreen-mcp] failed to read project file ${path}:`, e);
    return null;
  }
  let rec: ProjectRecord;
  try {
    rec = JSON.parse(raw) as ProjectRecord;
  } catch (e) {
    console.error(`[appscreen-mcp] corrupt project JSON in ${path}:`, e);
    return null;
  }
  // inline=true rebuilds data URLs from the blob store (for the browser). Default
  // returns refs (compact — used by listing and MCP read-modify-write tools).
  if (opts.inline) await inlineRecord(rec);
  return rec;
}

// Per-project async mutex. Concurrent MCP agents (the user runs several in
// parallel) each do read-modify-write of the whole project document; without a
// lock their writes clobber each other (lost updates). withProjectLock serializes
// all writes to the SAME project id, while different projects still run fully in
// parallel — so parallel imports are safe AND fast.
const projectLocks = new Map<string, Promise<unknown>>();
export function withProjectLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const key = safeId(id);
  const prev = projectLocks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn); // run after the previous holder, success or fail
  const tail = run.then(() => {}, () => {});
  projectLocks.set(key, tail);
  // Drop the entry once we're the last in line, so the map doesn't grow forever.
  tail.then(() => { if (projectLocks.get(key) === tail) projectLocks.delete(key); });
  return run;
}

/**
 * Atomic read-modify-write: load the project, run the mutator on it, and save —
 * all under the project's lock, so parallel callers can't lose each other's
 * changes. Returns the saved record and the mutator's result.
 */
export async function mutateProject<T>(
  id: string,
  mutator: (rec: ProjectRecord) => T | Promise<T>,
): Promise<{ rec: ProjectRecord; result: T }> {
  return withProjectLock(id, async () => {
    const rec = await getProject(id);
    if (!rec) throw new Error(`No project: ${id}`);
    const result = await mutator(rec);
    const saved = await saveProject(rec); // no baseRev: MCP wins, but serialized → no loss
    return { rec: saved, result };
  });
}

/** Read just the stored revision of a project (0 if it exists without one, null if absent). */
export async function readRev(id: string): Promise<number | null> {
  try {
    const rec = JSON.parse(await readFile(fileFor(id), "utf8")) as ProjectRecord;
    return typeof rec.rev === "number" ? rec.rev : 0;
  } catch {
    return null; // no existing record
  }
}

export async function saveProject(
  rec: ProjectRecord,
  opts: { baseRev?: number } = {},
): Promise<ProjectRecord> {
  assertWritableStore();
  await ensureDir();
  if (!rec || !rec.id) throw new Error("project record needs an id");
  rec.id = safeId(rec.id);
  if (!Array.isArray(rec.screenshots)) rec.screenshots = [];
  // Externalize any inline data URLs to the blob store (no-op for refs the web
  // app already uploaded). Keeps project.json tiny and dedups image bytes.
  await externalizeRecord(rec);
  // Optimistic concurrency: bump a monotonic rev on every write. When the caller
  // passes baseRev (the web app sends the rev it loaded), reject a write whose
  // base is older than what's on disk — that's a stale tab trying to overwrite
  // newer data (e.g. screenshots Claude/MCP pushed while it sat idle). MCP tools
  // omit baseRev: they read-modify-write fresh state and always win. Read→write
  // has no await in between, so the rev stays monotonic under Node's single thread.
  const prevRev = await readRev(rec.id);
  if (opts.baseRev != null && prevRev != null && opts.baseRev < prevRev) {
    throw new ConflictError(prevRev);
  }
  rec.rev = (prevRev ?? 0) + 1;
  rec.updatedAt = new Date().toISOString();
  // Atomic write (tmp + rename): a reader never sees partial JSON, and a crash
  // mid-write can't truncate the project file. The ".json.tmp" suffix keeps tmp
  // files invisible to listProjects/gcBlobs (they only pick up "*.json").
  const final = fileFor(rec.id);
  const tmp = `${final}.tmp`;
  await writeFile(tmp, JSON.stringify(rec));
  await rename(tmp, final);
  // An explicit save of a previously-deleted id revives it — drop the tombstone
  // so syncing browsers don't discard the revived project from their cache.
  try { await clearTombstone(rec.id); } catch { /* best effort */ }
  projectEvents.emit("saved", { id: rec.id, rev: rec.rev }); // live-update browsers via SSE
  return rec;
}

export async function deleteProject(id: string): Promise<boolean> {
  assertWritableStore();
  await ensureDir();
  // Serialized with all other writers to this id, so a concurrent mutate can't
  // resurrect the file mid-delete. The lock lives HERE and nowhere else for
  // deletes: withProjectLock is a promise-chain mutex (not re-entrant), so
  // callers must NOT wrap deleteProject in the same lock.
  return withProjectLock(id, async () => {
    try {
      await rm(fileFor(id));
      // Authoritative deletion: tombstone it so a stale browser cache can't
      // silently migrate the project back up on its next sync.
      try { await addTombstone(id); } catch (e) { console.warn("[appscreen-mcp] tombstone write failed:", e); }
      projectEvents.emit("deleted", { id: safeId(id) });
      return true;
    } catch {
      return false;
    }
  });
}

// ---------- Defaults for new projects / screenshots ----------
// Kept in lock-step with state.defaults in app.js so server-created projects
// open cleanly in the web app.

function defaultRecord(id: string, name: string): ProjectRecord {
  return {
    id: safeId(id),
    name,
    formatVersion: 2,
    screenshots: [],
    selectedIndex: 0,
    outputDevice: "iphone-6.9",
    customWidth: 1290,
    customHeight: 2796,
    currentLanguage: "en",
    projectLanguages: ["en"],
    defaults: defaultSettings(),
  };
}

function defaultSettings() {
  return {
    background: {
      type: "gradient",
      gradient: { angle: 135, stops: [{ color: "#667eea", position: 0 }, { color: "#764ba2", position: 100 }] },
      solid: "#1a1a2e",
      image: null,
      imageFit: "cover",
      imageBlur: 0,
      overlayColor: "#000000",
      overlayOpacity: 0,
      noise: false,
      noiseIntensity: 10,
    },
    screenshot: {
      scale: 70, y: 60, x: 50, rotation: 0, perspective: 0, cornerRadius: 24,
      deviceModel2D: "iphone", deviceMacFinish: "silver", deviceWatchFinish: "midnight",
      bezelEnabled: false, spanScreens: 1,
      use3D: false, device3D: "iphone", rotation3D: { x: 0, y: 0, z: 0 },
      shadow: { enabled: true, color: "#000000", blur: 40, opacity: 30, x: 0, y: 20 },
      frame: { enabled: false, color: "#1d1d1f", width: 12, opacity: 100, notch: "none" },
    },
    text: {
      headlineEnabled: true, headlineBgColor: "#000000", headlineBgOpacity: 0,
      subheadlineBgColor: "#000000", subheadlineBgOpacity: 0, subheadlineSpacing: 0,
      perScreenText: false, panelHeadlines: {}, panelSubheadlines: {},
      headlines: { en: "" }, headlineLanguages: ["en"], currentHeadlineLang: "en",
      headlineFont: "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
      headlineSize: 100, headlineWeight: "600", headlineItalic: false,
      headlineUnderline: false, headlineStrikethrough: false, headlineColor: "#ffffff",
      perLanguageLayout: false,
      languageSettings: { en: { headlineSize: 100, subheadlineSize: 50, position: "top", offsetY: 12, lineHeight: 110 } },
      currentLayoutLang: "en", position: "top", offsetY: 12, lineHeight: 110,
      subheadlineEnabled: false, subheadlines: { en: "" }, subheadlineLanguages: ["en"],
      currentSubheadlineLang: "en", subheadlineFont: "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
      subheadlineSize: 50, subheadlineWeight: "400", subheadlineItalic: false,
      subheadlineUnderline: false, subheadlineStrikethrough: false,
      subheadlineColor: "#ffffff", subheadlineOpacity: 70,
    },
    elements: [],
    popouts: [],
  };
}

export async function createProject(name: string, id?: string): Promise<ProjectRecord> {
  const newId = safeId(id || `project_${Date.now()}`);
  // Exists-check + save under the project lock, so two concurrent creates with
  // the same explicit id can't both pass the check.
  return withProjectLock(newId, async () => {
    if (await getProject(newId)) throw new Error(`project already exists: ${newId}`);
    return saveProject(defaultRecord(newId, name || "Untitled Project"));
  });
}

function newScreenshot(rec: ProjectRecord, name: string): any {
  const d = rec.defaults || defaultSettings();
  const clone = (o: any) => JSON.parse(JSON.stringify(o));
  return {
    src: "",
    name: name || `Screen ${rec.screenshots.length + 1}`,
    deviceType: undefined,
    localizedImages: {},
    background: clone(d.background),
    screenshot: clone(d.screenshot),
    text: clone(d.text),
    elements: [],
    popouts: [],
    overrides: {},
  };
}

// ---------- Per-language mutation helpers ----------

function addLanguage(rec: ProjectRecord, lang: string): void {
  if (!lang) return;
  if (!Array.isArray(rec.projectLanguages)) rec.projectLanguages = ["en"];
  if (!rec.projectLanguages.includes(lang)) rec.projectLanguages.push(lang);
}

function ensureLangArray(obj: any, key: string, lang: string): void {
  if (!Array.isArray(obj[key])) obj[key] = [];
  if (!obj[key].includes(lang)) obj[key].push(lang);
}

/** Set headline and/or subheadline text on a screenshot, for one or many languages. */
export function setScreenshotText(
  rec: ProjectRecord,
  index: number,
  opts: {
    language?: string;
    headline?: string;
    subheadline?: string;
    headlines?: Record<string, string>;
    subheadlines?: Record<string, string>;
  },
): void {
  const s = rec.screenshots[index];
  if (!s) throw new Error(`no screenshot at index ${index}`);
  if (!s.text) s.text = JSON.parse(JSON.stringify((rec.defaults || defaultSettings()).text));
  const t = s.text;
  if (!t.headlines) t.headlines = {};
  if (!t.subheadlines) t.subheadlines = {};

  const lang = opts.language || rec.currentLanguage || "en";

  const headMap = opts.headlines || (opts.headline !== undefined ? { [lang]: opts.headline } : null);
  if (headMap) {
    for (const [l, v] of Object.entries(headMap)) {
      t.headlines[l] = v;
      ensureLangArray(t, "headlineLanguages", l);
      addLanguage(rec, l);
    }
    t.headlineEnabled = true;
  }

  const subMap = opts.subheadlines || (opts.subheadline !== undefined ? { [lang]: opts.subheadline } : null);
  if (subMap) {
    for (const [l, v] of Object.entries(subMap)) {
      t.subheadlines[l] = v;
      ensureLangArray(t, "subheadlineLanguages", l);
      addLanguage(rec, l);
    }
    t.subheadlineEnabled = true;
  }
}

/**
 * Set a screenshot's background (gradient or solid). `target` is a screenshot
 * index, or "all" to apply the same background to every screenshot (the app's
 * "Sync design to all screens"). Only the fields present in `patch` are changed;
 * the rest of the background (overlay, noise, image-fit, …) is preserved.
 * Returns the list of screenshot indices that were updated.
 */
export function setScreenshotBackground(
  rec: ProjectRecord,
  target: number | "all",
  patch: {
    type?: "gradient" | "solid" | "image";
    gradient?: { angle: number; stops: { color: string; position: number }[] };
    solid?: string;
    overlayColor?: string;
    overlayOpacity?: number;
    noise?: boolean;
    noiseIntensity?: number;
  },
): number[] {
  const idxs = target === "all" ? rec.screenshots.map((_, i) => i) : [target];
  if (idxs.length === 0) throw new Error("project has no screenshots");
  const applied: number[] = [];
  for (const i of idxs) {
    const s = rec.screenshots[i];
    if (!s) throw new Error(`no screenshot at index ${i}`);
    if (!s.background) s.background = JSON.parse(JSON.stringify(defaultSettings().background));
    const b = s.background;
    if (patch.type) b.type = patch.type;
    if (patch.gradient) b.gradient = patch.gradient;
    if (patch.solid != null) b.solid = patch.solid;
    if (patch.overlayColor != null) b.overlayColor = patch.overlayColor;
    if (patch.overlayOpacity != null) b.overlayOpacity = patch.overlayOpacity;
    if (patch.noise != null) b.noise = patch.noise;
    if (patch.noiseIntensity != null) b.noiseIntensity = patch.noiseIntensity;
    applied.push(i);
  }
  return applied;
}

/**
 * Recursive merge: objects merge key-by-key, everything else (scalars, arrays,
 * null) replaces. Mutates and returns `target` when it's a mergeable object.
 */
function deepMerge(target: any, patch: any): any {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const out = target && typeof target === "object" && !Array.isArray(target) ? target : {};
  for (const k of Object.keys(patch)) {
    const pv = patch[k];
    if (pv && typeof pv === "object" && !Array.isArray(pv)) out[k] = deepMerge(out[k], pv);
    else out[k] = pv;
  }
  return out;
}

/**
 * Generic per-screenshot patch — can change ANY screenshot parameter (background,
 * device placement under `screenshot`, text styling under `text`, `elements`,
 * `popouts`, `name`, `deviceType`, …). `target` is an index or "all". Objects
 * deep-merge (only the fields present change); arrays and scalars replace.
 * Returns the updated indices.
 */
export function updateScreenshot(
  rec: ProjectRecord,
  target: number | "all",
  patch: Record<string, any>,
): number[] {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("patch must be an object");
  const idxs = target === "all" ? rec.screenshots.map((_, i) => i) : [target];
  if (idxs.length === 0) throw new Error("project has no screenshots");
  const d = defaultSettings();
  for (const i of idxs) {
    const s = rec.screenshots[i];
    if (!s) throw new Error(`no screenshot at index ${i}`);
    // Seed missing sections from defaults so a partial patch lands on a full object.
    for (const sect of ["background", "screenshot", "text"] as const) {
      if (patch[sect] !== undefined && !s[sect]) s[sect] = JSON.parse(JSON.stringify((rec.defaults || d)[sect]));
    }
    deepMerge(s, patch);
  }
  return idxs;
}

// Top-level fields the generic project patch must never touch: identity/versioning
// are server-managed, and screenshots have their own dedicated tools.
const PROTECTED_PROJECT_KEYS = new Set(["id", "rev", "updatedAt", "screenshots"]);

/**
 * Generic project-level patch — name, outputDevice, customWidth/Height,
 * currentLanguage, projectLanguages, selectedIndex, defaults, … Objects
 * deep-merge; arrays and scalars replace. Returns the keys applied.
 */
export function updateProjectSettings(rec: ProjectRecord, patch: Record<string, any>): string[] {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("patch must be an object");
  const applied: string[] = [];
  for (const k of Object.keys(patch)) {
    if (PROTECTED_PROJECT_KEYS.has(k)) continue;
    const pv = patch[k];
    if (pv && typeof pv === "object" && !Array.isArray(pv)) rec[k] = deepMerge(rec[k], pv);
    else rec[k] = pv;
    applied.push(k);
  }
  if (applied.length === 0) throw new Error("nothing to update (id/rev/screenshots are protected)");
  return applied;
}

/** Remove a screenshot; keeps selectedIndex valid. Returns the remaining count. */
export function removeScreenshot(rec: ProjectRecord, index: number): number {
  if (!rec.screenshots[index]) throw new Error(`no screenshot at index ${index}`);
  rec.screenshots.splice(index, 1);
  const max = Math.max(0, rec.screenshots.length - 1);
  if (typeof rec.selectedIndex === "number" && rec.selectedIndex > max) rec.selectedIndex = max;
  return rec.screenshots.length;
}

/** Move a screenshot from one position to another. Returns the new order of names. */
export function reorderScreenshots(rec: ProjectRecord, from: number, to: number): string[] {
  const n = rec.screenshots.length;
  if (from < 0 || from >= n) throw new Error(`no screenshot at index ${from}`);
  if (to < 0 || to >= n) throw new Error(`target index ${to} out of range (0-${n - 1})`);
  const [moved] = rec.screenshots.splice(from, 1);
  rec.screenshots.splice(to, 0, moved);
  return rec.screenshots.map((s, i) => s.name || `Screen ${i + 1}`);
}

/** Set the screenshot image for a given language (data URL). */
export function setScreenshotImage(
  rec: ProjectRecord,
  index: number,
  dataUrl: string,
  opts: { language?: string; name?: string } = {},
): void {
  const s = rec.screenshots[index];
  if (!s) throw new Error(`no screenshot at index ${index}`);
  const lang = opts.language || rec.currentLanguage || "en";
  const name = opts.name || s.name || `image_${lang}`;
  if (!s.localizedImages) s.localizedImages = {};
  s.localizedImages[lang] = { src: dataUrl, name };
  // Keep the legacy single-image field pointed at the project's current language
  // so older render paths and previews still find an image.
  if (lang === (rec.currentLanguage || "en") || !s.src) s.src = dataUrl;
  addLanguage(rec, lang);
}

/** Append a new (optionally image-bearing) screenshot; returns its index. */
export function addScreenshot(
  rec: ProjectRecord,
  opts: { name?: string; image?: string; language?: string } = {},
): number {
  const s = newScreenshot(rec, opts.name || "");
  rec.screenshots.push(s);
  const index = rec.screenshots.length - 1;
  if (opts.image) setScreenshotImage(rec, index, opts.image, { language: opts.language, name: opts.name });
  return index;
}

// ---------- Image resolution (input form → data URL) ----------

function detectMime(buf: Buffer): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57) return "image/webp";
  if (buf[0] === 0x42 && buf[1] === 0x4d) return "image/bmp";
  const head = buf.slice(0, 64).toString("utf8").trimStart();
  if (head.startsWith("<?xml") || head.startsWith("<svg")) return "image/svg+xml";
  return "image/png";
}

// Accepts the same image forms as render.ts (data URL, appscreen-file:// ref,
// http(s) URL, raw base64, or a server path) and returns an inline data URL
// suitable for storing in a project record.
export async function resolveImageToDataUrl(input: string): Promise<string> {
  if (input.startsWith("data:")) return input;

  let buf: Buffer;
  let mime: string | undefined;

  if (input.startsWith("appscreen-file://")) {
    const id = input.slice("appscreen-file://".length).replace(/\.[a-z0-9]+$/i, "");
    const f = getUploadedFile(id);
    if (!f) throw new Error(`appscreen-file not found or expired: ${id}`);
    buf = f.buf;
    mime = f.mime;
  } else if (/^https?:\/\//i.test(input)) {
    await assertPublicUrl(input); // SSRF guard (see security.ts)
    const res = await fetch(input);
    if (!res.ok) throw new Error(`Failed to fetch image (HTTP ${res.status}): ${input}`);
    buf = Buffer.from(await res.arrayBuffer());
    mime = res.headers.get("content-type")?.split(";")[0] || undefined;
  } else {
    const compact = input.replace(/\s+/g, "");
    if (/^(iVBORw0KGgo|\/9j\/|R0lGOD|UklGR|Qk[01]|AAAA)/.test(compact)) {
      buf = Buffer.from(compact, "base64");
    } else {
      buf = await readFile(imagePathFor(input)); // confined to MCP_IMAGE_DIR
    }
  }

  if (!mime) mime = detectMime(buf);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

// ---------- Summaries (compact view for tool responses) ----------

// Replace inline data URLs with a short descriptor so tool output stays small.
function shrinkImageRef(src: any): any {
  if (typeof src !== "string") return src;
  if (src.startsWith("data:")) {
    const comma = src.indexOf(",");
    const approxBytes = Math.floor(((src.length - comma - 1) * 3) / 4);
    return `<inline image, ~${approxBytes} bytes>`;
  }
  return src;
}

export function summarizeProject(rec: ProjectRecord): any {
  // Settings are included in full (they're small, structured JSON) so an AI can
  // read the current value of anything update_screenshot / update_project can
  // patch. Only raw image bytes (data URLs) are shrunk to short descriptors.
  const shrinkDeep = (o: any): any => {
    if (typeof o === "string") return shrinkImageRef(o);
    if (Array.isArray(o)) return o.map(shrinkDeep);
    if (o && typeof o === "object")
      return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, shrinkDeep(v)]));
    return o;
  };
  const textStyleOf = (t: any) => {
    if (!t) return t;
    const { headlines, subheadlines, ...style } = t;
    return style; // content is surfaced separately below
  };
  return {
    id: rec.id,
    name: rec.name,
    rev: rec.rev ?? 0,
    outputDevice: rec.outputDevice,
    customWidth: rec.customWidth,
    customHeight: rec.customHeight,
    selectedIndex: rec.selectedIndex,
    currentLanguage: rec.currentLanguage,
    projectLanguages: rec.projectLanguages || ["en"],
    screenshotCount: rec.screenshots.length,
    updatedAt: rec.updatedAt,
    defaults: rec.defaults ? shrinkDeep(rec.defaults) : undefined,
    screenshots: rec.screenshots.map((s: any, i: number) => ({
      index: i,
      name: s.name,
      languages: s.localizedImages ? Object.keys(s.localizedImages) : [],
      images: s.localizedImages
        ? Object.fromEntries(
            Object.entries(s.localizedImages).map(([l, v]: [string, any]) => [
              l,
              { name: v?.name, image: shrinkImageRef(v?.src) },
            ]),
          )
        : {},
      headlines: s.text?.headlines || {},
      subheadlines: s.text?.subheadlines || {},
      headlineEnabled: s.text?.headlineEnabled ?? true,
      subheadlineEnabled: s.text?.subheadlineEnabled ?? false,
      background: shrinkDeep(s.background),
      device: s.screenshot, // placement/effects (patch via update_screenshot {screenshot:{...}})
      textStyle: textStyleOf(s.text),
      elements: shrinkDeep(s.elements || []),
      popouts: shrinkDeep(s.popouts || []),
    })),
  };
}
