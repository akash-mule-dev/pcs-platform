// Drift monitor — the lock-state machine + continuous-refine scheduler.
//
// The "World Locking / FrozenWorld" analog's policy layer. Given the current AR +
// lock telemetry it decides (a) the lock STATE to surface in the HUD and (b) whether
// to kick a continuous ICP refine right now. Pure so the throttle/gating/hysteresis
// is jest-testable (the native engine just exposes `refineLock()`; cadence is decided
// here and proven by drift-monitor.test.ts).
//
// Authority order, highest first:
//   1. A live image marker pins the model to the physical object → drift-free, no ICP.
//   2. Continuous ICP fills the gaps between markers — but ONLY on good tracking, only
//      when the user isn't moving the model, and only on a throttle, so it can never
//      thrash the device or fight a manual nudge.
//   3. Otherwise the model holds its last good pose (existing tracked-anchor baseline).
export type LockState = 'searching' | 'locked' | 'drifting' | 'refining' | 'lost';

export interface DriftSample {
  now: number;
  placed: boolean;
  /** ARKit tracking state: 'starting' | 'normal' | 'limited' | 'unavailable' | … */
  tracking: string;
  /** User is dragging / twisting / measuring / registering — never auto-correct then. */
  userInteracting: boolean;
  /** A marker is currently driving the pose (authoritative, drift-free). */
  hasActiveMarker: boolean;
  /** Last continuous/ICP residual in mm (null = never refined yet). */
  lastResidualMm: number | null;
  /** ms of the last continuous refine attempt (null = none yet). */
  lastRefineAt: number | null;
  /** A refine is already running (don't stack another). */
  refineInFlight: boolean;
}

export interface DriftParams {
  /** Min gap between continuous refines (ms). */
  refineIntervalMs: number;
  /** Residual ≤ this ⇒ locked (mm). */
  goodResidualMm: number;
  /** Residual ≥ this ⇒ drifting (mm). */
  driftResidualMm: number;
}

export const DEFAULT_DRIFT_PARAMS: DriftParams = {
  refineIntervalMs: 2500,
  goodResidualMm: 8,
  driftResidualMm: 20,
};

export interface DriftDecision {
  state: LockState;
  shouldRefine: boolean;
  reason: string;
}

/**
 * Pure decision over one telemetry sample: the lock state for the HUD and whether a
 * continuous ICP refine is due. See the authority order in the file header.
 */
export function evaluateDrift(
  s: DriftSample,
  params: DriftParams = DEFAULT_DRIFT_PARAMS,
): DriftDecision {
  if (!s.placed) return { state: 'searching', shouldRefine: false, reason: 'not-placed' };
  if (s.tracking === 'unavailable')
    return { state: 'lost', shouldRefine: false, reason: 'tracking-unavailable' };

  // (1) A live marker pins the model to the physical object — authoritative.
  if (s.hasActiveMarker)
    return { state: 'locked', shouldRefine: false, reason: 'marker-locked' };

  // (2) ICP only on good tracking — refining against a limited-tracking world map
  //     would bake the drift in, not remove it.
  if (s.tracking !== 'normal')
    return { state: 'drifting', shouldRefine: false, reason: 'tracking-limited' };

  if (s.refineInFlight)
    return { state: 'refining', shouldRefine: false, reason: 'refine-in-flight' };

  const throttled =
    s.lastRefineAt != null && s.now - s.lastRefineAt < params.refineIntervalMs;
  const canRefine = !s.userInteracting && !throttled;

  let state: LockState;
  if (s.lastResidualMm == null) state = 'locked';
  else if (s.lastResidualMm >= params.driftResidualMm) state = 'drifting';
  else if (s.lastResidualMm <= params.goodResidualMm) state = 'locked';
  else state = 'drifting';

  // Refine when we've never refined, or the residual is above the "good" band.
  const shouldRefine =
    canRefine && (s.lastResidualMm == null || s.lastResidualMm > params.goodResidualMm);
  if (shouldRefine) state = 'refining';

  return {
    state,
    shouldRefine,
    reason: shouldRefine
      ? 'due-for-refine'
      : throttled
        ? 'throttled'
        : s.userInteracting
          ? 'user-interacting'
          : 'within-tolerance',
  };
}

// ── Alignment failure watcher (FabStation's AlignmentFailureWatcher analog) ──
//
// FabStation arms an AlignmentFailureWatcher with timeout thresholds
// (ALIGNMENT_FAILURE_THRESHOLD_IN_SECONDS) that fires a re-localisation (AlignAgain)
// once the overlay has been off the steel past tolerance for too long. Our analog:
// when NO marker is correcting the model and it has been continuously drifting for
// longer than the threshold, prompt the inspector to re-aim at a marker (the cheap,
// authoritative fix) / trigger a re-localize. Pure so the timeout is jest-testable.
export interface FailureWatchSample {
  now: number;
  /** A marker is actively driving the model (drift-free) — never a failure then. */
  hasActiveMarker: boolean;
  /** ms when the model first entered an uncorrected/drifting state this run; null when
   *  it is NOT currently drifting (reset to null the moment a marker re-locks). */
  driftingSince: number | null;
}

export interface FailureWatchParams {
  /** Sustained uncorrected drift beyond this triggers the re-aim prompt (ms). */
  failureThresholdMs: number;
}

export const DEFAULT_FAILURE_PARAMS: FailureWatchParams = { failureThresholdMs: 6000 };

/**
 * Has the overlay been uncorrected (no marker driving it) for longer than the failure
 * threshold? When true the UI should surface a "re-aim at a marker" prompt / kick a
 * re-localize. A live marker (hasActiveMarker) always clears it.
 */
export function shouldTriggerRealign(
  s: FailureWatchSample,
  p: FailureWatchParams = DEFAULT_FAILURE_PARAMS,
): boolean {
  if (s.hasActiveMarker) return false;
  if (s.driftingSince == null) return false;
  return s.now - s.driftingSince >= p.failureThresholdMs;
}

// ── Far-from-origin precision guard (FabStation's "too far from Global 0,0,0" / WLT
// re-centring analog) ── Single-precision float degrades far from the AR world origin
// (the session start point), so a model anchored tens of metres away jitters and tracks
// less accurately. Past this distance the UI warns and offers to re-center the world
// origin near the part (ARKit setWorldOrigin) so coordinates stay small and precise.
export const DEFAULT_FAR_ORIGIN_M = 25;

export function isFarFromOrigin(distanceM: number, thresholdM = DEFAULT_FAR_ORIGIN_M): boolean {
  return Number.isFinite(distanceM) && distanceM > thresholdM;
}

/** Human-readable, QA-friendly label for a lock state (HUD chip text). */
export function lockStateLabel(state: LockState): string {
  switch (state) {
    case 'locked':
      return 'Locked';
    case 'refining':
      return 'Locking…';
    case 'drifting':
      return 'Drifting — re-scan';
    case 'searching':
      return 'Place the model';
    case 'lost':
      return 'Tracking lost';
  }
}
