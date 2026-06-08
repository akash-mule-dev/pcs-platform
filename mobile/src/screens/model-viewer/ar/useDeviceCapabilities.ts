// Ported from glb-viewer, adapted for PCS: expo-device is lazy-`require`d (not a
// static import) so the module is safe to import in Expo Go / Jest, and so the
// project type-checks before `expo install expo-device` has been run.
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { hasLiDAR } from './deviceCapabilities';

// Lazy-load expo-device. If it isn't installed/available, capabilities default
// to "no depth sensor" (conservative — the operator is warned rather than
// silently trusted).
let Device: any = null;
try {
  Device = require('expo-device');
} catch {
  // expo-device unavailable — handled by the defaults below.
}

export interface DeviceCapabilities {
  /** Detection has run (modelId resolved). */
  checked: boolean;
  /** iOS tablet. */
  isPad: boolean;
  /** iOS hardware identifier, e.g. "iPad14,3" (null on Android). */
  modelId: string | null;
  /** Human-readable model name, e.g. "iPad Pro". */
  modelName: string | null;
  /**
   * True only for a real LiDAR scene-depth scanner. This is what drives stable
   * AR registration on reflective/low-texture surfaces and accurate real-world
   * hit-tests. NOT the same as Viro's monocular-depth fallback, which every
   * iOS device reports as "supported".
   */
  hasDepthSensor: boolean;
}

const isPad = Platform.OS === 'ios' ? Platform.isPad === true : false;

const INITIAL: DeviceCapabilities = {
  checked: false,
  isPad,
  modelId: null,
  modelName: null,
  hasDepthSensor: false,
};

/**
 * Resolves the running device's depth-sensing capability. Used to warn
 * operators on non-LiDAR devices (where the BIM overlay drifts more and
 * measurements are approximate) and to steer them toward Image-Marker mode.
 */
export function useDeviceCapabilities(): DeviceCapabilities {
  const [caps, setCaps] = useState<DeviceCapabilities>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    try {
      const modelId: string | null = Device?.modelId ?? null;
      const modelName: string | null = Device?.modelName ?? null;
      if (!cancelled) {
        setCaps({
          checked: true,
          isPad,
          modelId,
          modelName,
          hasDepthSensor: Platform.OS === 'ios' ? hasLiDAR(modelId) : false,
        });
      }
    } catch (err) {
      if (__DEV__) console.warn('Device capability detection failed:', err);
      if (!cancelled) setCaps((c) => ({ ...c, checked: true }));
    }
    return () => {
      cancelled = true;
    };
  }, []);

  return caps;
}
