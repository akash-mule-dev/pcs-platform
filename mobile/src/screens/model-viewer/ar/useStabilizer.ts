// useStabilizer — the JS brain of the FabStation-style anti-drift stack.
//
// Ties the unit-tested pure modules (marker-lock.ts, drift-monitor.ts) to the native
// <PcsLidarArView>: it consumes the throttled onMarkerUpdate / onLockStatus / onAutoAlign
// telemetry, derives the lock STATE + active marker for the HUD, and — on a throttle —
// drives the continuous ICP world-lock by calling the native refineLock() between marker
// sightings. The per-frame marker pose drive itself is native; this layer is policy +
// readout only, so it stays cheap and testable.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  selectActiveMarker,
  MarkerObservation,
} from './marker-lock';
import {
  evaluateDrift,
  DriftSample,
  DEFAULT_DRIFT_PARAMS,
  LockState,
  shouldTriggerRealign,
  DEFAULT_FAILURE_PARAMS,
  isFarFromOrigin,
} from './drift-monitor';

interface NativeMarker {
  name: string;
  transform: number[];
  tracked: boolean;
  bound: boolean;
  distance: number;
}
interface MarkerUpdate {
  markers: NativeMarker[];
  cameraPos: [number, number, number];
  active: string | null;
  lockEnabled: boolean;
  acceptedCount?: number;
  holding?: boolean;
  /** Distance (m) of the model anchor from the AR world origin (Layer-4 precision guard). */
  originDistanceM?: number;
}
interface AutoAlignResult {
  ok: boolean;
  rmsMm?: number;
  reason?: string;
  continuous?: boolean;
}

export interface StabilizerInput {
  arRef: React.MutableRefObject<any>;
  placed: boolean;
  tracking: string;
  /** User is dragging / twisting / measuring / registering — suppresses auto-refine. */
  userInteracting: boolean;
  /** The user has armed marker lock (drives `markerLock` on the native view). */
  markerLockOn: boolean;
  /** The user has armed the continuous ICP world-lock. */
  continuousLockOn: boolean;
}

export interface StabilizerState {
  lockState: LockState;
  activeMarker: string | null;
  trackedCount: number;
  boundCount: number;
  /** At least one marker is visible right now (so Bind is meaningful). */
  markerVisible: boolean;
  /** Lock armed + bound but nothing acceptable in view → frozen on last pose. */
  holding: boolean;
  /** Holding/uncorrected past the failure threshold → prompt the inspector to re-aim. */
  needsReaim: boolean;
  /** Model anchored far from the AR world origin → float precision degrades; offer re-center. */
  farFromOrigin: boolean;
  lastResidualMm: number | null;
  onMarkerUpdate: (e: { nativeEvent: MarkerUpdate }) => void;
  onLockStatus: (e: { nativeEvent: { totalBindings?: number; reason?: string } }) => void;
  /** Call from the screen's onAutoAlign so the monitor sees continuous-refine results. */
  noteAutoAlign: (ev: AutoAlignResult) => void;
  bindMarkers: () => void;
  clearBindings: () => void;
}

const POLL_MS = 400; // lock-state evaluation + refine-scheduling cadence

export function useStabilizer(input: StabilizerInput): StabilizerState {
  const { arRef, placed, tracking, userInteracting, markerLockOn, continuousLockOn } = input;

  // Live telemetry kept in refs so the polling interval reads fresh values without
  // re-subscribing every render.
  const markersRef = useRef<MarkerObservation[]>([]);
  const boundNamesRef = useRef<Set<string>>(new Set());
  const cameraRef = useRef<[number, number, number]>([0, 0, 0]);
  const activeRef = useRef<string | null>(null);
  const residualRef = useRef<number | null>(null);
  const lastRefineAtRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  // ms the model first went uncorrected (no active marker) this run; null while locked.
  const driftingSinceRef = useRef<number | null>(null);

  const [lockState, setLockState] = useState<LockState>('searching');
  const [activeMarker, setActiveMarker] = useState<string | null>(null);
  const [trackedCount, setTrackedCount] = useState(0);
  const [boundCount, setBoundCount] = useState(0);
  const [markerVisible, setMarkerVisible] = useState(false);
  const [holding, setHolding] = useState(false);
  const [needsReaim, setNeedsReaim] = useState(false);
  const [farFromOrigin, setFarFromOrigin] = useState(false);
  const [lastResidualMm, setLastResidualMm] = useState<number | null>(null);

  const onMarkerUpdate = useCallback(
    (e: { nativeEvent: MarkerUpdate }) => {
      const { markers, cameraPos } = e.nativeEvent;
      const now = Date.now();
      const obs: MarkerObservation[] = markers.map((m) => ({
        name: m.name,
        transform: m.transform,
        tracked: m.tracked,
        lastSeen: now,
      }));
      markersRef.current = obs;
      boundNamesRef.current = new Set(markers.filter((m) => m.bound).map((m) => m.name));
      cameraRef.current = cameraPos;

      const visibleTracked = markers.filter((m) => m.tracked).length;
      setTrackedCount(visibleTracked);
      setMarkerVisible(visibleTracked > 0);
      setHolding(!!e.nativeEvent.holding);
      if (typeof e.nativeEvent.originDistanceM === 'number') {
        setFarFromOrigin(isFarFromOrigin(e.nativeEvent.originDistanceM));
      }

      // Derive the active marker with the unit-tested policy (mirrors the native pick).
      const sel = selectActiveMarker(obs, boundNamesRef.current, {
        now,
        cameraPos,
        currentActive: activeRef.current,
      });
      activeRef.current = sel.active;
      setActiveMarker(sel.active);
    },
    [],
  );

  const onLockStatus = useCallback(
    (e: { nativeEvent: { totalBindings?: number } }) => {
      if (typeof e.nativeEvent.totalBindings === 'number') setBoundCount(e.nativeEvent.totalBindings);
    },
    [],
  );

  const noteAutoAlign = useCallback((ev: AutoAlignResult) => {
    // Any auto-align result (manual Auto-snap OR a continuous refine) clears the
    // in-flight flag and updates the residual the monitor reasons over.
    inFlightRef.current = false;
    if (typeof ev.rmsMm === 'number' && (ev.ok || ev.reason === 'no-improvement')) {
      residualRef.current = ev.rmsMm;
      setLastResidualMm(ev.rmsMm);
    }
  }, []);

  const bindMarkers = useCallback(() => {
    arRef.current?.bindVisibleMarkers?.();
  }, [arRef]);

  const clearBindings = useCallback(() => {
    arRef.current?.clearMarkerBindings?.();
    boundNamesRef.current = new Set();
    setBoundCount(0);
  }, [arRef]);

  // The scheduler: evaluate the drift state and kick a continuous refine when due.
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      // Watchdog: a refine that never reported back (e.g. a native guard returned
      // before emitting) must not wedge the scheduler.
      if (inFlightRef.current && lastRefineAtRef.current && now - lastRefineAtRef.current > 4000) {
        inFlightRef.current = false;
      }
      const hasActiveMarker = markerLockOn && activeRef.current != null;

      // Alignment failure watcher (FabStation's AlignmentFailureWatcher analog): track
      // how long the model has been uncorrected and, past the threshold, ask the
      // inspector to re-aim at a marker. A live marker clears it immediately.
      if (hasActiveMarker || !placed || !markerLockOn) {
        driftingSinceRef.current = null;
      } else if (driftingSinceRef.current == null) {
        driftingSinceRef.current = now;
      }
      setNeedsReaim(
        shouldTriggerRealign(
          { now, hasActiveMarker, driftingSince: driftingSinceRef.current },
          DEFAULT_FAILURE_PARAMS,
        ),
      );

      const sample: DriftSample = {
        now,
        placed,
        tracking,
        userInteracting,
        hasActiveMarker,
        lastResidualMm: residualRef.current,
        lastRefineAt: lastRefineAtRef.current,
        refineInFlight: inFlightRef.current,
      };
      const decision = evaluateDrift(sample, DEFAULT_DRIFT_PARAMS);
      // The monitor says "refining" whenever a refine is DUE; if the continuous lock
      // isn't armed we won't actually run one, so report the honest state instead
      // (amber "drifting" — the model is unanchored, bind a marker or arm a lock).
      const displayState =
        decision.state === 'refining' && !continuousLockOn ? 'drifting' : decision.state;
      setLockState(displayState);

      // Only drive the continuous ICP when the user has armed it; marker lock alone is
      // already drift-free, and the monitor returns shouldRefine=false when a marker is
      // active anyway.
      if (continuousLockOn && decision.shouldRefine && !inFlightRef.current) {
        inFlightRef.current = true;
        lastRefineAtRef.current = now;
        arRef.current?.refineLock?.();
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [arRef, placed, tracking, userInteracting, markerLockOn, continuousLockOn]);

  // Reset residual/active when placement is lost (model unplaced / re-centred).
  useEffect(() => {
    if (!placed) {
      residualRef.current = null;
      activeRef.current = null;
      setActiveMarker(null);
      setLastResidualMm(null);
      setHolding(false);
      setNeedsReaim(false);
      setFarFromOrigin(false);
      driftingSinceRef.current = null;
    }
  }, [placed]);

  return {
    lockState,
    activeMarker,
    trackedCount,
    boundCount,
    markerVisible,
    holding,
    needsReaim,
    farFromOrigin,
    lastResidualMm,
    onMarkerUpdate,
    onLockStatus,
    noteAutoAlign,
    bindMarkers,
    clearBindings,
  };
}
