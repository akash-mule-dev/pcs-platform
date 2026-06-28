// Persist a model's last AR registration (scale, rotation, render mode) per
// modelId, so reopening the same physical assembly restores the inspector's
// setup instead of starting from defaults. Placement *position* is intentionally
// NOT restored — it's environment-specific and must be re-set against the real
// object each session. Tracking mode is also NOT persisted: the session always
// opens in the stable default and is switched inline in-AR (TrackingModeSwitcher).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Vec3, RenderMode } from './types';

const KEY_PREFIX = 'pcs_ar_registration:';
const MARKERS_KEY_PREFIX = 'pcs_ar_marker_bindings:';
const MARKER_WIDTH_KEY = 'pcs_ar_marker_width_m';

interface SavedRegistration {
  scale: Vec3;
  rotation: Vec3;
  renderMode: RenderMode;
  savedAt: number;
}

function key(modelId: string): string {
  return `${KEY_PREFIX}${modelId}`;
}

export async function loadRegistration(
  modelId: string | null,
): Promise<SavedRegistration | null> {
  if (!modelId) return null;
  try {
    const raw = await AsyncStorage.getItem(key(modelId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedRegistration;
    // Minimal shape validation — ignore anything malformed.
    if (!Array.isArray(parsed.scale) || !Array.isArray(parsed.rotation)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveRegistration(
  modelId: string | null,
  reg: Omit<SavedRegistration, 'savedAt'>,
): Promise<void> {
  if (!modelId) return;
  try {
    await AsyncStorage.setItem(
      key(modelId),
      JSON.stringify({ ...reg, savedAt: Date.now() }),
    );
  } catch {
    // best-effort persistence
  }
}

// ── Marker-binding persistence (FabStation's cached-marker-pose analog) ──
// Each binding is a marker-relative offset (16 column-major floats), so it's frame-
// independent: restoring it lets the model re-lock the instant a known printed marker is
// re-detected — across walk-away, backgrounding, or an app restart — without re-aligning.
// Stored per modelId, separate from the scale/rotation registration above.
export type MarkerBindings = Record<string, number[]>;

function markersKey(modelId: string): string {
  return `${MARKERS_KEY_PREFIX}${modelId}`;
}

export async function loadMarkerBindings(
  modelId: string | null,
): Promise<MarkerBindings | null> {
  if (!modelId) return null;
  try {
    const raw = await AsyncStorage.getItem(markersKey(modelId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MarkerBindings;
    if (!parsed || typeof parsed !== 'object') return null;
    // Keep only well-formed 16-float entries (a malformed blob can't poison the lock).
    const clean: MarkerBindings = {};
    for (const [name, m] of Object.entries(parsed)) {
      if (Array.isArray(m) && m.length === 16 && m.every((n) => Number.isFinite(n))) {
        clean[name] = m;
      }
    }
    return Object.keys(clean).length ? clean : null;
  } catch {
    return null;
  }
}

export async function saveMarkerBindings(
  modelId: string | null,
  bindings: MarkerBindings,
): Promise<void> {
  if (!modelId) return;
  try {
    if (!bindings || Object.keys(bindings).length === 0) {
      await AsyncStorage.removeItem(markersKey(modelId));
      return;
    }
    await AsyncStorage.setItem(markersKey(modelId), JSON.stringify(bindings));
  } catch {
    // best-effort persistence
  }
}

// ── Printed marker physical size (device-global, not per-model) ──
// The marker's real edge length is ARKit's ONLY metric scale reference: a printed size
// that differs from this biases every detected pose by the scale ratio (a consistent
// offset that grows with distance). Confirmed once per device in the Stability panel and
// reused thereafter so the inspector can't silently get it wrong.
export async function loadMarkerWidthM(fallback: number): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(MARKER_WIDTH_KEY);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) && n > 0.02 ? n : fallback;
  } catch {
    return fallback;
  }
}

export async function saveMarkerWidthM(widthM: number): Promise<void> {
  if (!(widthM > 0.02)) return;
  try {
    await AsyncStorage.setItem(MARKER_WIDTH_KEY, String(widthM));
  } catch {
    // best-effort persistence
  }
}
