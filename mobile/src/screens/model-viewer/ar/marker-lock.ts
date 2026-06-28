// Image-marker lock — the FabStation-style anti-drift core.
//
// FabStation (Vuforia) defeats drift by sticking many printed Image-Target markers
// on the steel and re-anchoring the model to whichever one you've walked up to.
// This module is the iOS analog's BRAIN: given the set of markers ARKit currently
// reports (each an `ARImageAnchor` continuously slaved to its physical marker), it
//   • computes the model's pose offset in a marker's local frame at bind time, and
//   • reconstructs the model's world pose from that marker's LIVE (drift-free) pose,
//   • picks which bound marker should drive the model right now (nearest, freshly
//     tracked, with hysteresis so two near-equidistant markers don't flip-flop).
//
// Because an `ARImageAnchor` is re-solved against the physical marker every frame,
// driving the model from it cancels the steady-state VIO drift a free world anchor
// accumulates as you walk the length of a large piece — the exact gap the native
// engine's own comments flag as unsolved. Pure + dependency-free (jest-testable;
// the per-frame application lives natively in PcsLidarArView).
import {
  Mat4,
  V3,
  Quat,
  multiply4,
  invert4,
  translation4,
  quatFromMat4,
  mat4FromQuatTranslation,
} from './mat4';

export interface MarkerObservation {
  /** Stable marker id == the ARReferenceImage name (the printed marker's id). */
  name: string;
  /** Marker pose in WORLD space (column-major 16) at its last update. */
  transform: Mat4;
  /** ARKit is actively tracking it this frame (vs a stale last-known pose). */
  tracked: boolean;
  /** ms timestamp of the last update (for staleness). */
  lastSeen: number;
}

export interface SelectParams {
  now: number;
  /** Camera (device) world position — nearest marker tracks most accurately. */
  cameraPos: V3;
  /** The marker currently driving the pose (for hysteresis). */
  currentActive: string | null;
  /** A marker not seen within this many ms is ignored (default 1500). */
  staleMs?: number;
  /** Only switch active marker if a candidate is closer by more than this many
   *  metres (default 0.25) — kills per-frame flip-flop between two markers. */
  switchMarginM?: number;
}

export interface MarkerSelection {
  active: string | null;
  reason: string;
}

/** Model-pose offset expressed in the marker's local frame: `offset = marker⁻¹ · model`. */
export function computeBindOffset(markerWorld: Mat4, modelWorld: Mat4): Mat4 {
  return multiply4(invert4(markerWorld), modelWorld);
}

/** Reconstruct the model world pose from a (possibly drifted) LIVE marker pose:
 *  `model = markerLive · offset`. Identity-drift ⇒ unchanged; world drift D ⇒ the
 *  model rides exactly D with the marker (proven in marker-lock.test.ts). */
export function modelWorldFromMarker(markerWorld: Mat4, offset: Mat4): Mat4 {
  return multiply4(markerWorld, offset);
}

function dist(a: V3, b: V3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Choose which BOUND, freshly-tracked marker should drive the model pose. Nearest
 * to the camera wins (image tracking is most accurate up close), with hysteresis so
 * the model doesn't jitter between two equidistant markers. This is the MarkerPack
 * re-anchoring behaviour: as the inspector walks the piece, the active marker hands
 * off to the next one they approach.
 */
export function selectActiveMarker(
  observations: MarkerObservation[],
  boundNames: Set<string>,
  p: SelectParams,
): MarkerSelection {
  const staleMs = p.staleMs ?? 1500;
  const margin = p.switchMarginM ?? 0.25;
  const usable = observations.filter(
    (o) => boundNames.has(o.name) && o.tracked && p.now - o.lastSeen <= staleMs,
  );
  if (usable.length === 0) return { active: null, reason: 'no-usable-markers' };

  let best = usable[0];
  let bestD = dist(translation4(best.transform), p.cameraPos);
  for (const o of usable) {
    const d = dist(translation4(o.transform), p.cameraPos);
    if (d < bestD) {
      best = o;
      bestD = d;
    }
  }

  // Hysteresis: keep the current active marker unless the new best is meaningfully
  // closer, so two near-equidistant markers don't cause per-frame switching.
  if (p.currentActive && p.currentActive !== best.name) {
    const cur = usable.find((o) => o.name === p.currentActive);
    if (cur) {
      const curD = dist(translation4(cur.transform), p.cameraPos);
      if (curD - bestD < margin) return { active: cur.name, reason: 'held-by-hysteresis' };
    }
  }
  return {
    active: best.name,
    reason: p.currentActive === best.name ? 'unchanged' : 'switched-to-nearest',
  };
}

// ── Item 1+2: quality weighting + multi-marker fusion ──

export interface QualityParams {
  /** Beyond this range the marker is dropped (weight 0). Default 3.0 m. */
  maxRangeM?: number;
  /** Distance falloff scale — smaller favours close markers harder. Default 0.5 m. */
  nearFavorM?: number;
}

export const DEFAULT_QUALITY: Required<QualityParams> = { maxRangeM: 3.0, nearFavorM: 0.5 };

/**
 * Per-marker confidence weight in [0,1]. Untracked or beyond `maxRangeM` ⇒ 0 (gated
 * out); otherwise a smooth distance falloff (closer = higher) so a far/marginal marker
 * still CONTRIBUTES at low weight rather than being binary-lost — which is what keeps
 * the lock alive when good markers are scarce.
 */
export function markerWeight(o: MarkerObservation, cameraPos: V3, p: QualityParams = DEFAULT_QUALITY): number {
  if (!o.tracked) return 0;
  const maxR = p.maxRangeM ?? DEFAULT_QUALITY.maxRangeM;
  const near = p.nearFavorM ?? DEFAULT_QUALITY.nearFavorM;
  const d = Math.hypot(
    o.transform[12] - cameraPos[0],
    o.transform[13] - cameraPos[1],
    o.transform[14] - cameraPos[2],
  );
  if (d > maxR) return 0;
  const s = d / near;
  return 1 / (1 + s * s);
}

export interface WeightedPose {
  transform: Mat4;
  weight: number;
}

/**
 * Fuse several weighted rigid poses into one (Item 1): weighted-average translation +
 * sign-aligned weighted-average quaternion (normalized). Fusing all visible markers —
 * rather than snapping to the single nearest — cancels each marker's individual pose
 * noise and makes the hand-off as you walk seamless. Returns null if no positive
 * weight (caller then HOLDS its last pose — Item 2's freeze).
 */
export function fuseMarkerPoses(items: WeightedPose[]): Mat4 | null {
  let wsum = 0;
  const t: V3 = [0, 0, 0];
  const qsum: Quat = [0, 0, 0, 0];
  let ref: Quat | null = null;
  for (const it of items) {
    if (!(it.weight > 0)) continue;
    let q = quatFromMat4(it.transform);
    if (ref) {
      const dot = q[0] * ref[0] + q[1] * ref[1] + q[2] * ref[2] + q[3] * ref[3];
      if (dot < 0) q = [-q[0], -q[1], -q[2], -q[3]]; // hemisphere-align before averaging
    } else {
      ref = q;
    }
    qsum[0] += q[0] * it.weight;
    qsum[1] += q[1] * it.weight;
    qsum[2] += q[2] * it.weight;
    qsum[3] += q[3] * it.weight;
    const tr = translation4(it.transform);
    t[0] += tr[0] * it.weight;
    t[1] += tr[1] * it.weight;
    t[2] += tr[2] * it.weight;
    wsum += it.weight;
  }
  if (wsum < 1e-9) return null;
  const qlen = Math.hypot(qsum[0], qsum[1], qsum[2], qsum[3]);
  if (qlen < 1e-9) return null;
  const qn: Quat = [qsum[0] / qlen, qsum[1] / qlen, qsum[2] / qlen, qsum[3] / qlen];
  return mat4FromQuatTranslation(qn, [t[0] / wsum, t[1] / wsum, t[2] / wsum]);
}
