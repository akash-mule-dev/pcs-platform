import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api.service';
import { modelsService } from './models.service';

/**
 * Persistent on-device cache of project 3D models (GLBs).
 *
 * Goal: download each model ONCE and reuse it everywhere (project 3D viewer,
 * per-order 3D, per-assembly/part 3D + AR) instead of re-fetching on every open.
 *
 * Stored under `documentDirectory` (NOT cacheDirectory) so it SURVIVES logout
 * and app restarts — the OS only reclaims it on uninstall, and the user can
 * clear it from More → Offline 3D models. The model file endpoint
 * (`/models/:id/file`) is public, so cached files load with no network and work
 * offline. Models are keyed by their (immutable) modelId; if a model is ever
 * re-converted, clearing the cache re-pulls the latest.
 */
const TOKEN_KEY = 'auth_token';
const DIR = `${FileSystem.documentDirectory}model-cache/`;

type ProgressFn = (pct: number) => void;

function uriFor(modelId: string): string {
  return `${DIR}${modelId}.glb`;
}
function remoteUrl(modelId: string): string {
  return `${api.baseUrl}/models/${modelId}/file`;
}
async function authHeaders(): Promise<Record<string, string>> {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}
async function ensureDir(): Promise<void> {
  await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
}

// Concurrent loads of the same model share ONE download/promise.
const inflight = new Map<string, Promise<string>>();

async function download(modelId: string, onProgress?: ProgressFn): Promise<string> {
  await ensureDir();
  const dest = uriFor(modelId);
  const info = await FileSystem.getInfoAsync(dest);
  if (info.exists && (info.size ?? 0) > 0) return dest; // cache hit
  // Download to a temp file, then move — so an interrupted download is never
  // mistaken for a complete cache entry.
  const tmp = `${dest}.part`;
  await FileSystem.deleteAsync(tmp, { idempotent: true }).catch(() => {});
  const headers = await authHeaders();
  const resumable = FileSystem.createDownloadResumable(remoteUrl(modelId), tmp, { headers }, (p) => {
    if (!onProgress || !p.totalBytesExpectedToWrite || p.totalBytesExpectedToWrite < 0) return;
    onProgress(Math.max(0, Math.min(100, Math.round((p.totalBytesWritten / p.totalBytesExpectedToWrite) * 100))));
  });
  const dl = await resumable.downloadAsync();
  if (!dl || (dl.status && dl.status >= 400)) {
    await FileSystem.deleteAsync(tmp, { idempotent: true }).catch(() => {});
    throw new Error(`Model download failed (HTTP ${dl?.status ?? '???'})`);
  }
  await FileSystem.moveAsync({ from: tmp, to: dest });
  return dest;
}

async function collectProjectModelIds(): Promise<string[]> {
  const models = await modelsService.listAll().catch(() => []);
  // Project/fabrication GLBs only (skip the quality-inspection variants).
  return models.filter((m) => (m.modelType ?? 'assembly') !== 'quality').map((m) => m.id);
}

// Run the login warm-up at most once per signed-in session.
let prefetchToken: string | null = null;
let prefetching = false;

export const modelCache = {
  uriFor,

  async has(modelId: string): Promise<boolean> {
    const info = await FileSystem.getInfoAsync(uriFor(modelId));
    return info.exists && (info.size ?? 0) > 0;
  },

  /** Local file:// URI for a model, downloading + caching it on first use. */
  getLocalUri(modelId: string, onProgress?: ProgressFn): Promise<string> {
    const existing = inflight.get(modelId);
    if (existing) return existing;
    const p = download(modelId, onProgress).finally(() => inflight.delete(modelId));
    inflight.set(modelId, p);
    return p;
  },

  /** Base64 of the cached GLB (download-on-miss) — for WebView injection. */
  async getBase64(modelId: string, onProgress?: ProgressFn): Promise<string> {
    const uri = await this.getLocalUri(modelId, onProgress);
    return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  },

  /** Download a set of models with bounded concurrency (per-model failures are isolated). */
  async prefetch(
    modelIds: string[],
    opts?: { concurrency?: number; onEach?: (id: string, ok: boolean) => void },
  ): Promise<{ ok: number; failed: number }> {
    await ensureDir();
    const ids = [...new Set(modelIds.filter(Boolean))];
    const conc = Math.max(1, opts?.concurrency ?? 3);
    let i = 0, ok = 0, failed = 0;
    const worker = async () => {
      while (i < ids.length) {
        const id = ids[i++];
        try { await this.getLocalUri(id); ok++; opts?.onEach?.(id, true); }
        catch { failed++; opts?.onEach?.(id, false); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(conc, ids.length) }, worker));
    return { ok, failed };
  },

  /** Login warm-up: cache all project GLBs, once per session (best-effort, non-blocking). */
  async prefetchProjectModels(sessionKey: string): Promise<void> {
    if (prefetching || prefetchToken === sessionKey) return;
    prefetching = true;
    prefetchToken = sessionKey;
    try {
      const ids = await collectProjectModelIds();
      if (ids.length) await this.prefetch(ids, { concurrency: 3 });
    } finally {
      prefetching = false;
    }
  },

  /** Force a re-cache now (user-initiated, ignores the once-per-session guard). */
  async recacheNow(onEach?: (id: string, ok: boolean) => void): Promise<{ ok: number; failed: number }> {
    const ids = await collectProjectModelIds();
    if (!ids.length) return { ok: 0, failed: 0 };
    return this.prefetch(ids, { concurrency: 3, onEach });
  },

  /** Clear the once-per-session guard (call on logout). Cached FILES are kept. */
  resetSession(): void { prefetchToken = null; },

  async stats(): Promise<{ count: number; bytes: number }> {
    await ensureDir();
    const names = await FileSystem.readDirectoryAsync(DIR).catch(() => [] as string[]);
    let bytes = 0, count = 0;
    for (const n of names) {
      if (!n.endsWith('.glb')) continue; // ignore stray .part temp files
      const info = await FileSystem.getInfoAsync(`${DIR}${n}`);
      if (info.exists) { bytes += info.size ?? 0; count++; }
    }
    return { count, bytes };
  },

  /** Delete every cached model (user-initiated). They re-download when next viewed. */
  async clear(): Promise<void> {
    inflight.clear();
    await FileSystem.deleteAsync(DIR, { idempotent: true }).catch(() => {});
    await ensureDir();
  },
};
