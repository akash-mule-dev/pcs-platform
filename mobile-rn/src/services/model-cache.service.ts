import { LoadProgress } from '../types';

/**
 * Simple in-memory cache for loaded 3D model data.
 * In a full RN app with expo-three you'd cache GLTF objects;
 * here we cache the raw ArrayBuffer to avoid re-downloading.
 */

interface CacheEntry {
  data: ArrayBuffer;
  timestamp: number;
}

const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes
const MAX_ENTRIES = 10;
const cache = new Map<string, CacheEntry>();

function evictOldest() {
  if (cache.size < MAX_ENTRIES) return;
  let oldestKey = '';
  let oldestTs = Infinity;
  for (const [key, entry] of cache) {
    if (entry.timestamp < oldestTs) {
      oldestTs = entry.timestamp;
      oldestKey = key;
    }
  }
  if (oldestKey) cache.delete(oldestKey);
}

export const modelCacheService = {
  async load(
    url: string,
    onProgress?: (progress: LoadProgress) => void,
  ): Promise<ArrayBuffer> {
    const existing = cache.get(url);
    if (existing && Date.now() - existing.timestamp < MAX_AGE_MS) {
      onProgress?.({ loaded: 1, total: 1, percent: 100 });
      return existing.data;
    }

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch model: ${response.status}`);

    const contentLength = Number(response.headers.get('Content-Length') || 0);
    const reader = response.body?.getReader();
    if (!reader) {
      const buffer = await response.arrayBuffer();
      evictOldest();
      cache.set(url, { data: buffer, timestamp: Date.now() });
      onProgress?.({ loaded: contentLength, total: contentLength, percent: 100 });
      return buffer;
    }

    const chunks: Uint8Array[] = [];
    let loaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      if (contentLength > 0) {
        onProgress?.({
          loaded,
          total: contentLength,
          percent: Math.round((loaded / contentLength) * 100),
        });
      }
    }

    const buffer = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const arrayBuffer = buffer.buffer as ArrayBuffer;
    evictOldest();
    cache.set(url, { data: arrayBuffer, timestamp: Date.now() });
    return arrayBuffer;
  },

  evict(url: string): void {
    cache.delete(url);
  },

  clear(): void {
    cache.clear();
  },
};
