// Ephemeral in-memory file store for temporary download URLs.
// Each rendered PNG is kept under a random id and auto-deleted after its TTL,
// so a client (or browser) can fetch it once over HTTP instead of receiving a
// large base64 blob inline. Memory-only: nothing touches disk, and everything
// is gone on restart.

import { randomBytes } from "node:crypto";

interface Entry {
  buf: Buffer;
  mime: string;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
}

const store = new Map<string, Entry>();

/** Store a buffer; returns an unguessable id. Auto-evicts after ttlMs. */
export function putFile(buf: Buffer, mime: string, ttlMs: number): string {
  const id = randomBytes(16).toString("hex");
  const timer = setTimeout(() => store.delete(id), ttlMs);
  // Don't keep the process alive just for a pending eviction.
  if (typeof (timer as any).unref === "function") (timer as any).unref();
  store.set(id, { buf, mime, expiresAt: Date.now() + ttlMs, timer });
  return id;
}

/** Fetch a stored buffer, or null if missing/expired. */
export function getFile(id: string): { buf: Buffer; mime: string } | null {
  const e = store.get(id);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    clearTimeout(e.timer);
    store.delete(id);
    return null;
  }
  return { buf: e.buf, mime: e.mime };
}
