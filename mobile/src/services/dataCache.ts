import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Persistent cache-first store for project DATA (the project list + assembly
 * trees) — the JSON the 3D viewers fetch on every open. Backed by AsyncStorage,
 * which is NOT cleared on logout (logout only removes the token/user keys), so
 * once a project is loaded it isn't fetched again until the user refreshes
 * (pull-to-refresh / force) or clears the cache.
 *
 * Distinct from modelCache (GLB binaries on the filesystem); this is small JSON.
 */
const PREFIX = 'data_cache_v1:';

// Cache entries are namespaced by the signed-in principal so a shared device
// never serves one user's (tenant's) project data to another. Set on login,
// reset on logout (the FILES persist, so the SAME user re-logging in still hits
// their cache — "survives logout" — while a different user reads a clean slate).
let scope = 'anon';
function scopedKey(key: string): string { return `${PREFIX}${scope}:${key}`; }

export const dataCache = {
  /** Namespace all subsequent reads/writes to a principal (user id), or null = anon. */
  setScope(principal: string | null): void { scope = principal || 'anon'; },

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await AsyncStorage.getItem(scopedKey(key));
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },

  async set<T>(key: string, value: T): Promise<void> {
    try { await AsyncStorage.setItem(scopedKey(key), JSON.stringify(value)); } catch { /* best-effort */ }
  },

  /**
   * Cache-first: return the cached value if present (no network), otherwise
   * fetch it, cache it, and return it. `force` bypasses the cache to refetch
   * (and refreshes the stored copy) — used by pull-to-refresh.
   */
  async cached<T>(key: string, fetcher: () => Promise<T>, force = false): Promise<T> {
    if (!force) {
      const hit = await this.get<T>(key);
      // Treat a cached EMPTY array as a miss — otherwise a project opened
      // mid-conversion (no nodes yet) would cache [] and never refresh.
      if (hit != null && !(Array.isArray(hit) && hit.length === 0)) return hit;
    }
    const fresh = await fetcher();
    await this.set(key, fresh);
    return fresh;
  },

  async stats(): Promise<{ count: number }> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      return { count: keys.filter((k) => k.startsWith(PREFIX)).length };
    } catch {
      return { count: 0 };
    }
  },

  /** Remove all cached project data (user-initiated). */
  async clear(): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const mine = keys.filter((k) => k.startsWith(PREFIX));
      if (mine.length) await AsyncStorage.multiRemove(mine);
    } catch { /* best-effort */ }
  },
};
