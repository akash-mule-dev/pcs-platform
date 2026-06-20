// Camera-first, progressive model loader for the AR QA inspector.
//
// The whole point of this rewrite: NOTHING here blocks the AR camera. The host
// screen mounts the live camera immediately; this hook streams the model in
// over it and reports a phase the HUD shows as a small pill (never a black
// "preparing" screen).
//
// Pipeline (camera live throughout):
//   1. download  — fetch the project GLB to the app cache (network/disk only,
//                  with a real % so "Downloading 42%" is true). Cached by
//                  modelId and shared with the 3D viewer.
//   2. preparing — ONLY when a sub-part is requested: isolate it from the cached
//                  full GLB on-device. Skipped entirely for full-model opens.
//   3. ready     — the renderable file:// uri is set. The scene loads + auto-
//                  places it. This is the moment the model appears.
//
// Everything heavy is OFF the critical path:
//   • dimensions are extracted in the BACKGROUND after `ready` (overlays light
//     up a moment later — they never delay the model appearing);
//   • the wireframe GLB is generated ON DEMAND (only when the inspector picks
//     wireframe/edges), then cached.
// The decoded GLB bytes are kept in a ref so those passes never re-read disk.
import { useState, useEffect, useRef, useCallback } from 'react';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateWireframeGlb } from './wireframeGenerator';
import { extractDimensions, ModelDimensions } from './dimensionExtractor';
import { extractPartGlb } from './partExtractor';
import { base64ToBytes, bytesToBase64 } from './base64';
import { ModelPhase } from './types';

const TOKEN_KEY = 'auth_token';
const MODELS_SUBDIR = 'pcs-ar-models';

export interface UseRemoteModelResult {
  phase: ModelPhase;
  /** Local file:// uri of the renderable GLB (full or isolated). Null until ready. */
  uri: string | null;
  fileName: string;
  isolated: boolean;
  /** Extracted in the background after `ready` — null until then. */
  dimensions: ModelDimensions | null;
  /** Generated on demand via requestWireframe(); null until requested + built. */
  wireframeUri: string | null;
  wireframeBusy: boolean;
  error: string | null;
  /** Human-readable status for the loading pill (e.g. "Downloading 42%"). */
  progress: string | null;
  /** 0–100 while downloading, else null. */
  downloadPct: number | null;
  /** Re-run the whole pipeline after a failure. */
  retry: () => void;
  /** Build the wireframe GLB on demand (no-op if already built/busy). */
  requestWireframe: () => void;
}

function safeName(modelId: string): string {
  return modelId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

// Stable short key for a set of mesh names → names the isolated-GLB cache file.
function hashNames(names: string[]): string {
  const s = [...names].sort().join('');
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

const INITIAL: Omit<UseRemoteModelResult, 'retry' | 'requestWireframe'> = {
  phase: 'downloading',
  uri: null,
  fileName: 'model.glb',
  isolated: false,
  dimensions: null,
  wireframeUri: null,
  wireframeBusy: false,
  error: null,
  progress: 'Starting…',
  downloadPct: null,
};

export function useRemoteModel(
  fileUrl: string | null,
  modelId: string | null,
  fileName = 'model.glb',
  meshNames: string[] | null = null,
): UseRemoteModelResult {
  const isolateKey = meshNames && meshNames.length ? hashNames(meshNames) : '';

  const [state, setState] = useState<Omit<UseRemoteModelResult, 'retry' | 'requestWireframe'>>({
    ...INITIAL,
    fileName,
  });
  const [attempt, setAttempt] = useState(0);

  // The decoded bytes of the GLB we're showing + its on-disk path. Kept so the
  // background dimension pass and the on-demand wireframe pass never re-read.
  const activeBytesRef = useRef<Uint8Array | null>(null);
  const activeUriRef = useRef<string | null>(null);
  const wireframePathRef = useRef<string | null>(null);
  // Bumped on every (re)run so stale async work from a previous run is ignored.
  const runRef = useRef(0);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  useEffect(() => {
    const run = ++runRef.current;
    const alive = () => run === runRef.current;
    const set = (patch: Partial<typeof state>) => {
      if (alive()) setState((s) => ({ ...s, ...patch }));
    };

    activeBytesRef.current = null;
    activeUriRef.current = null;
    wireframePathRef.current = null;

    if (!fileUrl || !modelId) {
      set({ phase: 'error', error: 'No model to load.', progress: null });
      return;
    }

    const cacheRoot = FileSystem.cacheDirectory;
    if (!cacheRoot) {
      set({ phase: 'error', error: 'No cache directory on this platform.', progress: null });
      return;
    }

    const dir = `${cacheRoot}${MODELS_SUBDIR}/`;
    const baseKey = safeName(modelId);
    const fullUri = `${dir}${baseKey}.glb`;
    // `p2` cache version: older builds cached EMPTY isolated GLBs; bump forces a
    // fresh extraction with the fixed subtree-keeping logic.
    const variantKey = isolateKey ? `${baseKey}__p2_${isolateKey}` : baseKey;
    const wireframeUri = `${dir}${variantKey}_wireframe.glb`;
    wireframePathRef.current = wireframeUri;

    setState({ ...INITIAL, fileName, progress: 'Downloading model…' });

    (async () => {
      try {
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});

        // ── 1. Download the full project GLB once (reuse cached copy) ──
        const existingFull = await FileSystem.getInfoAsync(fullUri);
        if (!existingFull.exists) {
          const headers = await authHeaders();
          const resumable = FileSystem.createDownloadResumable(
            fileUrl,
            fullUri,
            { headers },
            (p) => {
              if (!p.totalBytesExpectedToWrite || p.totalBytesExpectedToWrite < 0) return;
              const pct = Math.max(
                0,
                Math.min(100, Math.round((p.totalBytesWritten / p.totalBytesExpectedToWrite) * 100)),
              );
              set({ downloadPct: pct, progress: `Downloading model… ${pct}%` });
            },
          );
          const dl = await resumable.downloadAsync();
          if (!dl || (dl.status && dl.status >= 400)) {
            throw new Error(`Download failed (HTTP ${dl?.status ?? '???'})`);
          }
        }
        if (!alive()) return;

        // ── 2. Isolate the requested part(s) — only when a sub-part is asked for ──
        let activeUri = fullUri;
        let isolated = false;
        if (isolateKey) {
          const variantUri = `${dir}${variantKey}.glb`;
          const variantInfo = await FileSystem.getInfoAsync(variantUri);
          if (variantInfo.exists) {
            activeUri = variantUri;
            isolated = true;
          } else {
            set({ phase: 'preparing', downloadPct: null, progress: 'Preparing part…' });
            const fullB64 = await FileSystem.readAsStringAsync(fullUri, {
              encoding: FileSystem.EncodingType.Base64,
            });
            const fullBytes = base64ToBytes(fullB64);
            try {
              const res = await extractPartGlb(fullBytes, meshNames as string[]);
              if (res.meshCount > 0) {
                await FileSystem.writeAsStringAsync(variantUri, bytesToBase64(res.data), {
                  encoding: FileSystem.EncodingType.Base64,
                });
                activeUri = variantUri;
                isolated = true;
                activeBytesRef.current = res.data; // reuse for dims/wireframe
              } else {
                // Nothing matched → fall back to the full model.
                activeBytesRef.current = fullBytes;
              }
            } catch (isoErr) {
              if (__DEV__) console.warn('Part isolation failed (non-fatal):', isoErr);
              activeBytesRef.current = fullBytes;
            }
          }
        }
        if (!alive()) return;

        // ── 3. READY — the model can render NOW. Nothing below blocks this. ──
        activeUriRef.current = activeUri;
        set({
          phase: 'ready',
          uri: activeUri,
          isolated,
          error: null,
          progress: null,
          downloadPct: null,
        });

        // ── 4. Dimensions in the BACKGROUND (overlays appear a beat later) ──
        (async () => {
          try {
            let bytes = activeBytesRef.current;
            if (!bytes) {
              const b64 = await FileSystem.readAsStringAsync(activeUri, {
                encoding: FileSystem.EncodingType.Base64,
              });
              bytes = base64ToBytes(b64);
              activeBytesRef.current = bytes;
            }
            if (!alive()) return;
            const dims = await extractDimensions(bytes);
            set({ dimensions: dims });
          } catch (dimErr) {
            if (__DEV__) console.warn('Dimension extraction failed (non-fatal):', dimErr);
          }
        })();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load model';
        set({ phase: 'error', error: message, progress: null, downloadPct: null });
      }
    })();

    return () => {
      // Invalidate this run; in-flight async resolves are ignored via alive().
      runRef.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl, modelId, fileName, isolateKey, attempt]);

  // On-demand wireframe: built from the cached bytes, cached to disk, reused.
  const requestWireframe = useCallback(() => {
    const run = runRef.current;
    const alive = () => run === runRef.current;
    (async () => {
      if (state.wireframeUri || state.wireframeBusy) return;
      const wfPath = wireframePathRef.current;
      const activeUri = activeUriRef.current;
      if (!wfPath || !activeUri) return;
      setState((s) => ({ ...s, wireframeBusy: true }));
      try {
        const existing = await FileSystem.getInfoAsync(wfPath);
        if (existing.exists) {
          if (alive()) setState((s) => ({ ...s, wireframeUri: wfPath, wireframeBusy: false }));
          return;
        }
        let bytes = activeBytesRef.current;
        if (!bytes) {
          const b64 = await FileSystem.readAsStringAsync(activeUri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          bytes = base64ToBytes(b64);
          activeBytesRef.current = bytes;
        }
        const wireframeData = await generateWireframeGlb(bytes);
        await FileSystem.writeAsStringAsync(wfPath, bytesToBase64(wireframeData), {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (alive()) setState((s) => ({ ...s, wireframeUri: wfPath, wireframeBusy: false }));
      } catch (wireErr) {
        if (__DEV__) console.warn('Wireframe generation failed (non-fatal):', wireErr);
        if (alive()) setState((s) => ({ ...s, wireframeBusy: false }));
      }
    })();
  }, [state.wireframeUri, state.wireframeBusy]);

  return { ...state, retry, requestWireframe };
}
