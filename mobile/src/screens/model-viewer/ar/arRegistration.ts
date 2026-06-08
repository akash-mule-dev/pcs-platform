// Persist a model's last AR registration (scale, rotation, render mode, and
// tracking mode) per modelId, so reopening the same physical assembly restores
// the inspector's setup instead of starting from defaults. Placement *position*
// is intentionally NOT restored — it's environment-specific and must be re-set
// against the real object each session.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Vec3, RenderMode, TrackingMode } from './types';

const KEY_PREFIX = 'pcs_ar_registration:';

export interface SavedRegistration {
  scale: Vec3;
  rotation: Vec3;
  renderMode: RenderMode;
  trackingMode: TrackingMode;
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
