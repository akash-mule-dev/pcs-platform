// Replaces glb-viewer's useFilePicker / useBundledModel.
//
// The model comes from the backend (`/api/models/:id/file`). This hook
// downloads the FULL project GLB to the app cache ONCE (keyed by modelId) and
// reuses it for every subsequent open — the 3D viewer and AR share that one
// download. When `meshNames` is supplied it then isolates just those part(s)
// on-device (extractPartGlb) into a small per-part GLB (also cached), so AR
// renders only the selected piece without any extra network calls. The
// wireframe + dimension passes run on whichever GLB we end up showing.
import { useState, useEffect } from 'react';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateWireframeGlb } from './wireframeGenerator';
import { extractDimensions, ModelDimensions } from './dimensionExtractor';
import { extractPartGlb } from './partExtractor';
import { base64ToBytes, bytesToBase64 } from './base64';

const TOKEN_KEY = 'auth_token';

export interface RemoteModel {
  uri: string; // local file:// uri to the GLB we're showing (full or isolated)
  fileName: string;
  wireframeUri: string | null;
  dimensions: ModelDimensions | null;
  isolated: boolean; // true when uri is a per-part isolated GLB
}

export interface RemoteModelState {
  model: RemoteModel | null;
  loading: boolean;
  error: string | null;
  progress: string | null;
}

const MODELS_SUBDIR = 'pcs-ar-models';

function safeName(modelId: string): string {
  return modelId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

// Stable short key for a set of mesh names → names the isolated-GLB cache file.
function hashNames(names: string[]): string {
  const s = [...names].sort().join('');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Download `fileUrl` (cached by `modelId`) and prepare it for the AR scene.
 * When `meshNames` is non-empty the scene shows only those part(s), isolated
 * on-device from the cached full GLB.
 */
export function useRemoteModel(
  fileUrl: string | null,
  modelId: string | null,
  fileName = 'model.glb',
  meshNames: string[] | null = null,
): RemoteModelState {
  // Derived, stable cache/effect key for the requested isolation (empty = full model).
  const isolateKey = meshNames && meshNames.length ? hashNames(meshNames) : '';

  const [state, setState] = useState<RemoteModelState>({
    model: null,
    loading: !!fileUrl,
    error: null,
    progress: null,
  });

  useEffect(() => {
    if (!fileUrl || !modelId) {
      setState({ model: null, loading: false, error: null, progress: null });
      return;
    }

    let cancelled = false;
    const set = (patch: Partial<RemoteModelState>) =>
      !cancelled && setState((s) => ({ ...s, ...patch }));

    (async () => {
      set({ loading: true, error: null, progress: 'Downloading model…' });

      const cacheRoot = FileSystem.cacheDirectory;
      if (!cacheRoot) {
        set({ loading: false, error: 'No cache directory available on this platform.' });
        return;
      }

      const dir = `${cacheRoot}${MODELS_SUBDIR}/`;
      const key = safeName(modelId);
      const fullUri = `${dir}${key}.glb`;
      const variantKey = isolateKey ? `${key}__p_${isolateKey}` : key;
      let activeUri = `${dir}${variantKey}.glb`;
      const wireframeUri = `${dir}${variantKey}_wireframe.glb`;

      try {
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});

        // ── 1. Download the FULL project GLB once (reuse cached copy) ──
        const existingFull = await FileSystem.getInfoAsync(fullUri);
        if (!existingFull.exists) {
          const headers = await authHeaders();
          const dl = await FileSystem.downloadAsync(fileUrl, fullUri, { headers });
          if (dl.status >= 400) {
            throw new Error(`Download failed (HTTP ${dl.status})`);
          }
        }
        if (cancelled) return;

        // ── 2. Isolate the requested part(s) from the cached full GLB (cached) ──
        let isolated = false;
        if (isolateKey) {
          const variantInfo = await FileSystem.getInfoAsync(activeUri);
          if (variantInfo.exists) {
            isolated = true;
          } else {
            set({ progress: 'Isolating part…' });
            const fullB64 = await FileSystem.readAsStringAsync(fullUri, {
              encoding: FileSystem.EncodingType.Base64,
            });
            const fullBytes = base64ToBytes(fullB64);
            try {
              const res = await extractPartGlb(fullBytes, meshNames as string[]);
              if (res.meshCount > 0) {
                await FileSystem.writeAsStringAsync(activeUri, bytesToBase64(res.data), {
                  encoding: FileSystem.EncodingType.Base64,
                });
                isolated = true;
              } else {
                activeUri = fullUri; // nothing matched → fall back to the full model
              }
            } catch (isoErr) {
              if (__DEV__) console.warn('Part isolation failed (non-fatal):', isoErr);
              activeUri = fullUri;
            }
          }
        }
        if (cancelled) return;

        // Read the bytes of whichever GLB we're showing, for the two passes below.
        set({ progress: 'Analyzing geometry…' });
        const activeB64 = await FileSystem.readAsStringAsync(activeUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const activeBytes = base64ToBytes(activeB64);
        if (cancelled) return;

        // ── 3. Wireframe (best-effort) ──
        let wfUri: string | null = null;
        try {
          const wfInfo = await FileSystem.getInfoAsync(wireframeUri);
          if (wfInfo.exists) {
            wfUri = wireframeUri;
          } else {
            set({ progress: 'Generating wireframe…' });
            const wireframeData = await generateWireframeGlb(activeBytes);
            await FileSystem.writeAsStringAsync(wireframeUri, bytesToBase64(wireframeData), {
              encoding: FileSystem.EncodingType.Base64,
            });
            wfUri = wireframeUri;
          }
        } catch (wireErr) {
          if (__DEV__) console.warn('Wireframe generation failed (non-fatal):', wireErr);
        }
        if (cancelled) return;

        // ── 4. Dimensions (best-effort) ──
        let dims: ModelDimensions | null = null;
        try {
          set({ progress: 'Measuring dimensions…' });
          dims = await extractDimensions(activeBytes);
        } catch (dimErr) {
          if (__DEV__) console.warn('Dimension extraction failed (non-fatal):', dimErr);
        }
        if (cancelled) return;

        set({
          loading: false,
          progress: null,
          error: null,
          model: { uri: activeUri, fileName, wireframeUri: wfUri, dimensions: dims, isolated },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load model';
        set({ loading: false, progress: null, error: message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileUrl, modelId, fileName, isolateKey]);

  return state;
}
