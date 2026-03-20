import { Injectable } from '@angular/core';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface LoadProgress {
  loaded: number;
  total: number;
  percent: number;
}

interface CacheEntry {
  gltf: GLTF;
  timestamp: number;
}

/**
 * Caches loaded GLTF models in memory so repeated views
 * of the same model don't re-download the file.
 *
 * Cache entries expire after MAX_AGE_MS (default 30 minutes).
 * The cache holds at most MAX_ENTRIES models to limit memory.
 */
@Injectable({ providedIn: 'root' })
export class ModelCacheService {
  private cache = new Map<string, CacheEntry>();
  private readonly MAX_AGE_MS = 30 * 60 * 1000;   // 30 minutes
  private readonly MAX_ENTRIES = 10;

  /**
   * Load a GLTF model from URL. Returns from cache if available.
   * @param url       The model file URL
   * @param onProgress Called with download progress (only on cache miss)
   * @returns         The loaded GLTF object
   */
  load(url: string, onProgress?: (progress: LoadProgress) => void): Promise<GLTF> {
    // Check cache first
    const cached = this.cache.get(url);
    if (cached && (Date.now() - cached.timestamp) < this.MAX_AGE_MS) {
      // Report instant 100% progress for cached models
      onProgress?.({ loaded: 1, total: 1, percent: 100 });
      return Promise.resolve(cached.gltf);
    }

    // Cache miss — download with progress tracking
    return new Promise((resolve, reject) => {
      const loader = new GLTFLoader();
      loader.load(
        url,
        (gltf) => {
          this.put(url, gltf);
          resolve(gltf);
        },
        (event) => {
          if (event.lengthComputable) {
            onProgress?.({
              loaded: event.loaded,
              total: event.total,
              percent: Math.round((event.loaded / event.total) * 100),
            });
          } else if (event.loaded) {
            // Server didn't send Content-Length; show indeterminate progress
            onProgress?.({
              loaded: event.loaded,
              total: 0,
              percent: -1, // -1 = indeterminate
            });
          }
        },
        (err) => reject(err),
      );
    });
  }

  /** Evict a specific model from cache */
  evict(url: string): void {
    this.cache.delete(url);
  }

  /** Clear the entire cache */
  clear(): void {
    this.cache.clear();
  }

  private put(url: string, gltf: GLTF): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.MAX_ENTRIES) {
      let oldestKey = '';
      let oldestTime = Infinity;
      for (const [key, entry] of this.cache) {
        if (entry.timestamp < oldestTime) {
          oldestTime = entry.timestamp;
          oldestKey = key;
        }
      }
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(url, { gltf, timestamp: Date.now() });
  }
}
