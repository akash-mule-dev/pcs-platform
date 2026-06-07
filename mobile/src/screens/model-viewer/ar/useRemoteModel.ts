// Replaces glb-viewer's useFilePicker / useBundledModel.
//
// glb-viewer loaded GLBs from a local document picker (Expo SDK 54 File/Paths
// API). In PCS the model comes from the backend (`/api/models/:id/file`), so
// this hook downloads it to the app cache (SDK 52 legacy expo-file-system),
// then runs the same on-device wireframe + dimension passes glb-viewer used.
//
// Wireframe and dimension extraction are best-effort: if @gltf-transform can't
// run on a given device/model, the model still loads in solid/ghost modes.
import { useState, useEffect } from 'react';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateWireframeGlb } from './wireframeGenerator';
import { extractDimensions, ModelDimensions } from './dimensionExtractor';
import { base64ToBytes, bytesToBase64 } from './base64';

const TOKEN_KEY = 'auth_token';

export interface RemoteModel {
  uri: string; // local file:// uri to the downloaded GLB
  fileName: string;
  wireframeUri: string | null;
  dimensions: ModelDimensions | null;
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

async function authHeaders(): Promise<Record<string, string>> {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Download `fileUrl` to the cache and prepare it for the AR scene.
 * `modelId` keys the local cache filename so repeat opens are instant.
 */
export function useRemoteModel(
  fileUrl: string | null,
  modelId: string | null,
  fileName = 'model.glb',
): RemoteModelState {
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
      const glbUri = `${dir}${key}.glb`;
      const wireframeUri = `${dir}${key}_wireframe.glb`;

      try {
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});

        // ── 1. Download the GLB (reuse cached copy when present) ──
        const existing = await FileSystem.getInfoAsync(glbUri);
        if (!existing.exists) {
          const headers = await authHeaders();
          const dl = await FileSystem.downloadAsync(fileUrl, glbUri, { headers });
          if (dl.status >= 400) {
            throw new Error(`Download failed (HTTP ${dl.status})`);
          }
        }
        if (cancelled) return;

        // Read the GLB bytes once for the two on-device passes.
        set({ progress: 'Analyzing geometry…' });
        const b64 = await FileSystem.readAsStringAsync(glbUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const glbBytes = base64ToBytes(b64);
        if (cancelled) return;

        // ── 2. Wireframe (best-effort) ──
        let wfUri: string | null = null;
        try {
          const wfInfo = await FileSystem.getInfoAsync(wireframeUri);
          if (wfInfo.exists) {
            wfUri = wireframeUri;
          } else {
            set({ progress: 'Generating wireframe…' });
            const wireframeData = await generateWireframeGlb(glbBytes);
            await FileSystem.writeAsStringAsync(
              wireframeUri,
              bytesToBase64(wireframeData),
              { encoding: FileSystem.EncodingType.Base64 },
            );
            wfUri = wireframeUri;
          }
        } catch (wireErr) {
          if (__DEV__) console.warn('Wireframe generation failed (non-fatal):', wireErr);
        }
        if (cancelled) return;

        // ── 3. Dimensions (best-effort) ──
        let dims: ModelDimensions | null = null;
        try {
          set({ progress: 'Measuring dimensions…' });
          dims = await extractDimensions(glbBytes);
        } catch (dimErr) {
          if (__DEV__) console.warn('Dimension extraction failed (non-fatal):', dimErr);
        }
        if (cancelled) return;

        set({
          loading: false,
          progress: null,
          error: null,
          model: { uri: glbUri, fileName, wireframeUri: wfUri, dimensions: dims },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load model';
        set({ loading: false, progress: null, error: message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileUrl, modelId, fileName]);

  return state;
}
