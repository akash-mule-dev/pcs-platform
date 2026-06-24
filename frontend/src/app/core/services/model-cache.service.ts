import { Injectable, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';

/**
 * A project whose 3D model bytes are cached on THIS device. Shown on the
 * Cached Projects page. The blob itself lives in the `blobs` store keyed by
 * `cacheKey`; this is the human-facing index entry.
 */
export interface CachedProjectEntry {
  projectId: string;
  name: string;
  projectNumber?: string | null;
  clientName?: string | null;
  /** The model id whose GLB is cached (for display / version awareness). */
  modelId: string | null;
  /** Key into the `blobs` store — the model file URL's pathname. */
  cacheKey: string;
  /** Content version (the project's latest completed-import token). When this
   *  changes, the project was updated in the pipeline → the blob is re-fetched
   *  even if the model id (and thus the key) stayed the same (a re-conversion). */
  version?: string | null;
  /** Cached blob size in bytes. */
  size: number;
  /** Epoch ms the blob was stored (also the LRU recency key — bumped on re-open). */
  cachedAt: number;
  /** Who cached it (best-effort, for info — listing is NOT user-scoped). */
  userId?: string | null;
  orgId?: string | null;
  /** Assembly node count at cache time (a quick "size of model" hint). */
  nodeCount?: number;
}

interface BlobRecord {
  key: string;
  blob: Blob;
  size: number;
  contentType: string;
  cachedAt: number;
}

const DB_NAME = 'pcs-model-cache';
const DB_VERSION = 1;
const BLOB_STORE = 'blobs';
const INDEX_STORE = 'projects';

/** LRU caps so the on-device cache can't grow without bound. When exceeded, the
 *  least-recently-cached projects (and their blobs) are evicted. */
const MAX_ENTRIES = 12;
const MAX_BYTES = 1_500_000_000; // ~1.5 GB

/**
 * Persistent, client-side cache for 3D model (GLB) bytes, backed by IndexedDB.
 *
 * WHY IndexedDB and not localStorage: GLBs are routinely multiple MB (tens of MB
 * for real fabrication models). localStorage is string-only and capped at ~5 MB
 * per origin, so it cannot hold them. IndexedDB stores Blobs natively under the
 * browser's per-origin storage budget (hundreds of MB+).
 *
 * SURVIVES LOGOUT: `AuthService.logout()` removes only its five named
 * localStorage keys — it never calls `localStorage.clear()` and never touches
 * IndexedDB. So this cache persists across logout, the 401 handler and a
 * user switch automatically; clearing it is an explicit user action on the
 * Cached Projects page.
 *
 * The model file route (`GET /api/models/:id/file`) is `@Public()`, so the
 * cached bytes carry NO auth token — nothing sensitive is persisted.
 *
 * Caching is keyed by the model file URL's PATHNAME (host-independent and
 * version-safe: a re-import / re-conversion yields a new model id → a new key,
 * so a stale blob is never silently served for new geometry).
 */
@Injectable({ providedIn: 'root' })
export class ModelCacheService {
  private auth = inject(AuthService);

  private dbPromise: Promise<IDBDatabase | null> | null = null;
  /** In-flight network fetches, deduped by cache key (collapses concurrent loads). */
  private inflight = new Map<string, Promise<Blob>>();

  /** Project ids with a cached model on this device — reactive for the UI. */
  readonly cachedIds = signal<Set<string>>(new Set());

  /** True if IndexedDB is unavailable (private mode / old browser) — caching is then a no-op. */
  readonly available = typeof indexedDB !== 'undefined';

  constructor() {
    if (this.available) void this.refreshIndex();
  }

  // ── Key derivation ─────────────────────────────────────────────────────────
  /** A stable, host-independent cache key for a model URL (its pathname), or
   *  null for non-cacheable URLs (blob:/data: — e.g. a locally picked file). */
  keyForUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    if (/^(blob|data):/i.test(url)) return null;
    try {
      const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
      return new URL(url, base).pathname;
    } catch {
      return null;
    }
  }

  // ── IndexedDB plumbing ───────────────────────────────────────────────────
  private openDb(): Promise<IDBDatabase | null> {
    if (!this.available) return Promise.resolve(null);
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      let req: IDBOpenDBRequest;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch {
        resolve(null);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(BLOB_STORE)) db.createObjectStore(BLOB_STORE, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(INDEX_STORE)) db.createObjectStore(INDEX_STORE, { keyPath: 'projectId' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
    return this.dbPromise;
  }

  private async run<T>(store: string, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
    const db = await this.openDb();
    if (!db) return null;
    return new Promise<T | null>((resolve) => {
      try {
        const tx = db.transaction(store, mode);
        const req = op(tx.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  private getAll<T>(store: string): Promise<T[]> {
    return this.run<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>).then((r) => r ?? []);
  }

  // ── Blob cache (read-through) ──────────────────────────────────────────────
  async getBlob(key: string): Promise<Blob | null> {
    const rec = await this.run<BlobRecord>(BLOB_STORE, 'readonly', (s) => s.get(key) as IDBRequest<BlobRecord>);
    return rec?.blob ?? null;
  }

  private async putBlob(rec: BlobRecord): Promise<void> {
    await this.run(BLOB_STORE, 'readwrite', (s) => s.put(rec));
  }

  private async deleteBlob(key: string): Promise<void> {
    await this.run(BLOB_STORE, 'readwrite', (s) => s.delete(key));
  }

  /**
   * Return the model's GLB bytes, from the cache if present, else fetch them
   * over the network and store them for next time. This is the read-through
   * path the 3D viewer uses, so repeat loads (tab switches, remounts, a second
   * viewer instance) never re-hit the API. Concurrent loads of the same URL
   * share a single network request.
   */
  async loadModelData(url: string, onProgress?: (pct: number) => void): Promise<ArrayBuffer> {
    const blob = await this.getOrFetchBlob(url, onProgress);
    return blob.arrayBuffer();
  }

  private async getOrFetchBlob(url: string, onProgress?: (pct: number) => void): Promise<Blob> {
    const key = this.keyForUrl(url);
    // Non-cacheable URL (blob:/data:) — fetch straight through, don't persist.
    if (!key || !this.available) return this.fetchWithProgress(url, onProgress);

    const existing = await this.getBlob(key);
    if (existing) { onProgress?.(100); return existing; }

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const p = this.fetchWithProgress(url, onProgress)
      .then(async (blob) => {
        try {
          await this.putBlob({ key, blob, size: blob.size, contentType: blob.type, cachedAt: Date.now() });
        } catch { /* quota / write failure — still return the bytes */ }
        this.inflight.delete(key);
        return blob;
      })
      .catch((err) => { this.inflight.delete(key); throw err; });
    this.inflight.set(key, p);
    return p;
  }

  /** Fetch a binary resource, reporting download progress when the server sends
   *  a Content-Length (else the caller shows an indeterminate spinner). */
  private async fetchWithProgress(url: string, onProgress?: (pct: number) => void): Promise<Blob> {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error(`Model download failed: HTTP ${res.status}`);
    const total = Number(res.headers.get('Content-Length')) || 0;
    const type = res.headers.get('Content-Type') || 'model/gltf-binary';
    if (!res.body || !total || !onProgress) return res.blob();

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) { chunks.push(value); received += value.length; onProgress(Math.min(100, Math.round((received / total) * 100))); }
    }
    return new Blob(chunks as BlobPart[], { type });
  }

  // ── Project index (the "Cached Projects" list) ─────────────────────────────
  /**
   * Record that a project's model is cached on this device (and ensure the blob
   * is stored). Called automatically by the project workspace once a model is
   * available — opening a project caches it. Best-effort: never throws to the
   * caller, never double-downloads (shares the read-through blob cache).
   *
   * VERSION-AWARE INVALIDATION — when a project is updated in the import
   * pipeline, the stale bytes are dropped so the new model is fetched fresh:
   *   • a NEW model id  ⇒ a new key ⇒ the previous blob is orphaned + deleted;
   *   • a re-conversion under the SAME id ⇒ same key but a new `version` token
   *     ⇒ the cached blob is force-deleted so it re-downloads.
   * Re-caching with an unchanged key + version is a cheap no-op (cache hit).
   */
  async cacheProject(
    meta: Pick<CachedProjectEntry, 'projectId' | 'name' | 'projectNumber' | 'clientName' | 'modelId' | 'nodeCount' | 'version'>,
    url: string,
    onProgress?: (pct: number) => void,
  ): Promise<CachedProjectEntry | null> {
    const key = this.keyForUrl(url);
    if (!key || !this.available) return null;
    try {
      const version = meta.version ?? null;
      const prev = await this.getEntry(meta.projectId);
      if (prev) {
        if (prev.cacheKey !== key) {
          // Model id changed — evict the now-orphaned previous blob.
          if (!(await this.keyReferencedByOther(prev.cacheKey, meta.projectId))) await this.deleteBlob(prev.cacheKey);
        } else if ((prev.version ?? null) !== version) {
          // Same key but the project was re-processed — force a fresh download.
          this.inflight.delete(key);
          await this.deleteBlob(key);
        }
      }
      const firstEver = (await this.countEntries()) === 0;
      const blob = await this.getOrFetchBlob(url, onProgress);
      const entry: CachedProjectEntry = {
        projectId: meta.projectId,
        name: meta.name,
        projectNumber: meta.projectNumber ?? null,
        clientName: meta.clientName ?? null,
        modelId: meta.modelId ?? null,
        cacheKey: key,
        version,
        size: blob.size,
        cachedAt: Date.now(),
        userId: this.auth.currentUser?.id ?? null,
        orgId: this.auth.currentUser?.organizationId ?? null,
        nodeCount: meta.nodeCount,
      };
      await this.run(INDEX_STORE, 'readwrite', (s) => s.put(entry));
      const next = new Set(this.cachedIds());
      next.add(entry.projectId);
      this.cachedIds.set(next);
      await this.enforceLimits();
      // First time anything is cached, ask to keep it from being evicted.
      if (firstEver) void this.requestPersistence();
      return entry;
    } catch {
      return null;
    }
  }

  private getEntry(projectId: string): Promise<CachedProjectEntry | null> {
    return this.run<CachedProjectEntry>(INDEX_STORE, 'readonly', (s) => s.get(projectId) as IDBRequest<CachedProjectEntry>);
  }

  private async countEntries(): Promise<number> {
    return (await this.run<number>(INDEX_STORE, 'readonly', (s) => s.count())) ?? 0;
  }

  /** True if another cached project still points at this blob key (don't delete it). */
  private async keyReferencedByOther(key: string, exceptProjectId: string): Promise<boolean> {
    const entries = await this.getAll<CachedProjectEntry>(INDEX_STORE);
    return entries.some((e) => e.projectId !== exceptProjectId && e.cacheKey === key);
  }

  /** Keep the cache within MAX_ENTRIES / MAX_BYTES, evicting least-recently-cached
   *  projects (and their unshared blobs). Always keeps the most recent entry. */
  private async enforceLimits(): Promise<void> {
    const entries = (await this.getAll<CachedProjectEntry>(INDEX_STORE)).sort((a, b) => b.cachedAt - a.cachedAt);
    const keep: CachedProjectEntry[] = [];
    const evict: CachedProjectEntry[] = [];
    let bytes = 0;
    for (const e of entries) {
      bytes += e.size ?? 0;
      const overCount = keep.length >= MAX_ENTRIES;
      const overBytes = bytes > MAX_BYTES && keep.length >= 1; // never evict the newest
      if (overCount || overBytes) evict.push(e); else keep.push(e);
    }
    if (!evict.length) return;
    const keptKeys = new Set(keep.map((e) => e.cacheKey));
    for (const e of evict) {
      await this.run(INDEX_STORE, 'readwrite', (s) => s.delete(e.projectId));
      if (!keptKeys.has(e.cacheKey)) await this.deleteBlob(e.cacheKey);
    }
    this.cachedIds.set(new Set(keep.map((e) => e.projectId)));
  }

  /** All projects cached on this device, newest first. */
  async listProjects(): Promise<CachedProjectEntry[]> {
    const entries = await this.getAll<CachedProjectEntry>(INDEX_STORE);
    return entries.sort((a, b) => b.cachedAt - a.cachedAt);
  }

  /** Synchronous (reactive) check used by the UI. */
  isCached(projectId: string): boolean {
    return this.cachedIds().has(projectId);
  }

  /** Remove one cached project: drop its index entry and its blob (unless another
   *  entry references the same blob). */
  async removeProject(projectId: string): Promise<void> {
    const entries = await this.getAll<CachedProjectEntry>(INDEX_STORE);
    const target = entries.find((e) => e.projectId === projectId);
    await this.run(INDEX_STORE, 'readwrite', (s) => s.delete(projectId));
    if (target) {
      const sharedByOther = entries.some((e) => e.projectId !== projectId && e.cacheKey === target.cacheKey);
      if (!sharedByOther) await this.deleteBlob(target.cacheKey);
    }
    const next = new Set(this.cachedIds());
    next.delete(projectId);
    this.cachedIds.set(next);
  }

  /** Wipe the entire cache (all blobs + the project index). */
  async clearAll(): Promise<void> {
    await this.run(BLOB_STORE, 'readwrite', (s) => s.clear());
    await this.run(INDEX_STORE, 'readwrite', (s) => s.clear());
    this.cachedIds.set(new Set());
  }

  /** Reload the reactive cached-id set from storage (call on startup). */
  async refreshIndex(): Promise<void> {
    const entries = await this.getAll<CachedProjectEntry>(INDEX_STORE);
    this.cachedIds.set(new Set(entries.map((e) => e.projectId)));
  }

  // ── Storage budget ──────────────────────────────────────────────────────
  /** Browser storage estimate + whether persistence has been granted. */
  async estimate(): Promise<{ usage: number; quota: number; persisted: boolean }> {
    let usage = 0, quota = 0, persisted = false;
    try {
      if (navigator.storage?.estimate) {
        const e = await navigator.storage.estimate();
        usage = e.usage ?? 0;
        quota = e.quota ?? 0;
      }
      if (navigator.storage?.persisted) persisted = await navigator.storage.persisted();
    } catch { /* not supported — leave zeros */ }
    return { usage, quota, persisted };
  }

  /** Ask the browser to make this origin's storage persistent (resist eviction). */
  async requestPersistence(): Promise<boolean> {
    try {
      if (navigator.storage?.persist) return await navigator.storage.persist();
    } catch { /* ignore */ }
    return false;
  }
}
