// Ported verbatim from glb-viewer. Pure logic — no native/Viro imports, safe to
// import anywhere (Expo Go / Jest included).
//
// LiDAR (scene-depth) hardware detection.
//
// ARKit's authoritative check — supportsFrameSemantics(.sceneDepth) — is
// native-only, and Viro's isDepthOcclusionSupported() reports `true` on *every*
// iOS device because it counts the monocular-depth fallback, so neither can
// distinguish a LiDAR iPad Pro from a non-LiDAR standard iPad from JS.
//
// A model-identifier allow-list is the reliable way to detect real LiDAR
// hardware. The set of LiDAR devices is small, well-known, and changes only
// when Apple ships new hardware. Append new LiDAR models here as they release.
//
// modelId values come from expo-device's `Device.modelId` (iOS only), e.g.
// "iPad14,3". `modelId` is the raw `hw.machine` identifier, so it resolves for
// EVERY device — current or future — independent of expo-device's version.
// Do NOT switch this to `Device.modelName`: that name comes from expo-device's
// own lookup table, which goes stale (e.g. 7.0.3 maps nothing past iPad16,x, so
// the M5 iPad Pro `iPad17,1` would report no usable name) — a name-based check
// silently misses brand-new devices. Numeric ranges are also unsafe: Apple mixes
// Pro / Air / mini within one `iPadN,*` family. Note too: the 2018 iPad Pro
// (iPad8,1–iPad8,8) and iPhone 11 Pro (iPhone12,3/12,5) do NOT have LiDAR, so an
// "is it a Pro" heuristic would misclassify them — the explicit id list is required.
const LIDAR_MODEL_IDS = new Set<string>([
  // iPad Pro 11" (2020, 2nd gen) / 12.9" (2020, 4th gen) — first LiDAR iPads
  'iPad8,9', 'iPad8,10', 'iPad8,11', 'iPad8,12',
  // iPad Pro 11" (3rd gen) / 12.9" (5th gen) — 2021, M1
  'iPad13,4', 'iPad13,5', 'iPad13,6', 'iPad13,7',
  'iPad13,8', 'iPad13,9', 'iPad13,10', 'iPad13,11',
  // iPad Pro 11" (4th gen) / 12.9" (6th gen) — 2022, M2
  'iPad14,3', 'iPad14,4', 'iPad14,5', 'iPad14,6',
  // iPad Pro 11" / 13" — 2024, M4
  'iPad16,3', 'iPad16,4', 'iPad16,5', 'iPad16,6',
  // iPad Pro 11" / 13" — 2025, M5 (odd id = Wi-Fi, even = Cellular; .1/.2 = 11", .3/.4 = 13")
  'iPad17,1', 'iPad17,2', 'iPad17,3', 'iPad17,4',
  // iPhone Pro / Pro Max with LiDAR (12 Pro → 17 Pro) — handheld alternative
  'iPhone13,3', 'iPhone13,4', // 12 Pro / Pro Max
  'iPhone14,2', 'iPhone14,3', // 13 Pro / Pro Max
  'iPhone15,2', 'iPhone15,3', // 14 Pro / Pro Max
  'iPhone16,1', 'iPhone16,2', // 15 Pro / Pro Max
  'iPhone17,1', 'iPhone17,2', // 16 Pro / Pro Max
  'iPhone18,1', 'iPhone18,2', // 17 Pro / Pro Max
]);

/**
 * True only for devices with a real LiDAR scene-depth scanner. Unknown or
 * missing model ids return false (conservative — the user is warned rather
 * than silently trusted), so a brand-new LiDAR device not yet in the list
 * shows the no-depth notice until it's added here.
 */
export function hasLiDAR(modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  return LIDAR_MODEL_IDS.has(modelId.trim());
}
