// Transcript images, cached by the page itself.
//
// The host in front of this server answers every response with "cache-control: no-store", which the browser's
// HTTP cache must honour and which also makes Chrome refuse to register a service worker script. Storing the
// bytes in IndexedDB is independent of both: the second time a picture is shown, it is read from this device.
import { useEffect, useState } from "react";

const DB_NAME = "omb-media";
const STORE = "images";
const DB_VERSION = 1;
const MEMORY_LIMIT = 120;

const memory = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

function readBlob(db: IDBDatabase, key: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function writeBlob(db: IDBDatabase, key: string, blob: Blob): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

function rememberInMemory(url: string, objectUrl: string): void {
  memory.set(url, objectUrl);
  while (memory.size > MEMORY_LIMIT) {
    const oldest = memory.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    const stale = memory.get(oldest);
    memory.delete(oldest);
    if (stale) URL.revokeObjectURL(stale);
  }
}

/** One URL per picture: the same bytes are fetched once per device, whatever the response headers say. */
export function cachedMediaUrl(url: string): Promise<string> {
  const hit = memory.get(url);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(url);
  if (pending) return pending;
  const task = (async () => {
    const db = await openDb();
    if (db) {
      const stored = await readBlob(db, url);
      if (stored) {
        const objectUrl = URL.createObjectURL(stored);
        rememberInMemory(url, objectUrl);
        return objectUrl;
      }
    }
    const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error(`media ${response.status}`);
    const blob = await response.blob();
    if (db) void writeBlob(db, url, blob);
    const objectUrl = URL.createObjectURL(blob);
    rememberInMemory(url, objectUrl);
    return objectUrl;
  })().finally(() => { inflight.delete(url); });
  inflight.set(url, task);
  return task;
}

/** The cached copy when this device has one; the original URL until then (and when it cannot be stored). */
export function useCachedMedia(src: string | undefined): string | undefined {
  const [resolved, setResolved] = useState<string | undefined>(() => (src ? memory.get(src) : undefined));
  useEffect(() => {
    if (!src) {
      setResolved(undefined);
      return;
    }
    const hit = memory.get(src);
    if (hit) {
      setResolved(hit);
      return;
    }
    let alive = true;
    setResolved(undefined);
    cachedMediaUrl(src)
      .then((url) => { if (alive) setResolved(url); })
      .catch(() => { if (alive) setResolved(src); });
    return () => { alive = false; };
  }, [src]);
  return resolved;
}
