// ARExperienceRK — the native RealityKit (LiDAR) AR experience.
//
// A separate, lean experience from the Viro ARExperience (which is left
// untouched — its single-mount/never-re-key navigator is load-bearing). This
// hosts the native <PcsLidarArView> (modules/pcs-lidar-ar) and drives its LiDAR
// modes AND reaches feature parity with the Viro inspector so the LiDAR mode is
// production-ready for quality inspection:
//   • Align   — move / rotate / scale / lock the placed model (native pivot).
//   • Edges   — solid ↔ wireframe edge view (the existing on-device wireframe GLB
//               pipeline, swapped into the native view in place).
//   • Measure — LiDAR raycast point-to-point: on-model ruler, real-world ruler,
//               and a model↔real DEVIATION probe → logged as a QA measurement.
//   • QA      — the SAME inspection log / sign-off / evidence / offline queue as
//               the Viro path (useQualityData), tagged to the fabrication context
//               (so a hold point gates the stage and the result rolls up to
//               Final QC), plus tap-a-part inspection.
//
// It reuses useRemoteModel, so the SAME cached file:// GLB the Viro path + 3D
// viewer use is handed straight to the native loader — no new pipeline. The
// measurement/transform math lives natively (one source of truth); this drives
// it via props + the view ref and reuses the Viro inspector's panels verbatim.
//
// Only ever mounted on iPad + LiDAR with the native module present (gated in
// ARViewScreen), so the static import of the native view is safe here.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  Share,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import { useRemoteModel } from './useRemoteModel';
import { useQualityData, ARQualityEntry } from './useQualityData';
import ToggleChip from './ToggleChip';
import ToolBar from './ToolBar';
import AlignPanel from './AlignPanel';
import AppearancePanel from './AppearancePanel';
import MeasurementPanel from './MeasurementPanel';
import RegisterPanel from './RegisterPanel';
import LockPanel from './LockPanel';
import QualityPanel from './QualityPanel';
import LogInspectionForm, { InspectionFormResult } from './LogInspectionForm';
import { projectsService, MNode } from '../../../services/projects.service';
import { modelsService } from '../../../services/models.service';
import { buildColorBy, ColorBy } from '../../projects/partviewer/viewerTools';
import { resolveRealScale } from './realScale';
import { UnitSystem } from './dimensionExtractor';
import { loadUnitSystem, saveUnitSystem } from './unitPreference';
import { solveRigid, PointPair, RigidFit } from './rigid-registration';
import { useStabilizer } from './useStabilizer';
import { lockStateLabel } from './drift-monitor';
import {
  loadMarkerBindings,
  saveMarkerBindings,
  loadMarkerWidthM,
  saveMarkerWidthM,
} from './arRegistration';
import { captureNativeSnapshot } from './arSnapshotNative';
import { useAuth } from '../../../context/AuthContext';
import { can } from '../../../config/permissions';
import { offlineService } from '../../../services/offline.service';
import { notifySuccess, notifyError } from '../../../utils/feedback';
import {
  LidarToggles,
  DEFAULT_LIDAR_TOGGLES,
  togglesToFlags,
  MeasurementState,
  DEFAULT_MEASUREMENTS,
  RenderMode,
  Vec3,
  DEFAULT_EDGE_COLOR,
  DEFAULT_EDGE_WEIGHT,
  DEFAULT_MODEL_OPACITY,
} from './types';
import { PcsLidarArView } from '../../../../modules/pcs-lidar-ar';

// The model loads ready for QA overlay: edges ON (red, from DEFAULT_EDGE_COLOR),
// semi-transparent (DEFAULT_MODEL_OPACITY) so the real part shows through, and
// painted by Profile so members are distinguishable straight away.
const DEFAULT_COLOR_BY: ColorBy = 'profile';

// Physical edge length of the printed AR markers (m) — must match the printed sheet
// (exportMarkerSheet stamps this size). 300 mm prints on a single A4/Letter page and
// tracks at much longer range than the old 150 mm (FabStation's steel packs are 650 mm),
// so a fresh drift-free fix is almost always in view as the inspector walks the piece.
const MARKER_WIDTH_M = 0.3;

// LiDAR layout: the Align/Edges/Measure toolbar is a right-side rail, so the
// docked panels sit LOW (just above the bottom edge) to free the model's space.
const PANEL_BOTTOM = 28;

// Quick height control for direct manipulation (the planar drag only moves x/z).
const ELEV_STEP = 0.001; // metres per tick (~1 mm) — matches AlignPanel's fine MOVE step
const ELEV_TICK_MS = 40;

/** Raise/lower the placed model in Y without opening the Align panel.
 *  Press-and-hold repeats, like the Align panel's hold buttons. */
function ElevationHandle({ onStep }: { onStep: (dy: number) => void }) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = useCallback(() => {
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);
  const start = useCallback(
    (dy: number) => {
      onStep(dy);
      stop();
      timer.current = setInterval(() => onStep(dy), ELEV_TICK_MS);
    },
    [onStep, stop],
  );
  useEffect(() => stop, [stop]);
  return (
    <View style={styles.elevHandle} pointerEvents="box-none">
      <TouchableOpacity style={styles.elevBtn} onPressIn={() => start(ELEV_STEP)} onPressOut={stop} activeOpacity={0.6}>
        <Text style={styles.elevGlyph}>▲</Text>
      </TouchableOpacity>
      <Text style={styles.elevLabel}>Height</Text>
      <TouchableOpacity style={styles.elevBtn} onPressIn={() => start(-ELEV_STEP)} onPressOut={stop} activeOpacity={0.6}>
        <Text style={styles.elevGlyph}>▼</Text>
      </TouchableOpacity>
    </View>
  );
}

interface Props {
  modelId: string;
  fileUrl: string;
  fileName?: string;
  meshNames?: string[] | null;
  partLabel?: string | null;
  qaContext?: { assemblyNodeId?: string; projectId?: string; stageId?: string; workOrderStageId?: string };
  onViewRecords?: () => void;
  onBack: () => void;
  /** Notifies the host that a docked tool panel is open, so it can hide the
   *  bottom-center engine switcher (which would otherwise sit under the panel). */
  onChromeBusy?: (busy: boolean) => void;
}

export default function ARExperienceRK({
  modelId,
  fileUrl,
  fileName = 'model.glb',
  meshNames = null,
  partLabel,
  qaContext,
  onViewRecords,
  onBack,
  onChromeBusy,
}: Props) {
  const model = useRemoteModel(fileUrl, modelId, fileName, meshNames ?? null);
  const arRef = useRef<any>(null);

  // ── LiDAR toggles + native session telemetry ──
  const [toggles, setToggles] = useState<LidarToggles>(DEFAULT_LIDAR_TOGGLES);
  const [tracking, setTracking] = useState<string>('starting');
  const [lidar, setLidar] = useState<boolean | null>(null);
  const [placed, setPlaced] = useState(false);
  const [nativeError, setNativeError] = useState<string | null>(null);
  const [capWarningDismissed, setCapWarningDismissed] = useState(false);
  // Scan-before-place: the model is held until the user maps the area + taps Place.
  // `scanReady` (from the native onScanState) = enough understanding to anchor well.
  const [scanReady, setScanReady] = useState(false);

  // ── Stability / anti-drift (FabStation-style marker lock + continuous world-lock) ──
  const [markerLockOn, setMarkerLockOn] = useState(false);
  const [continuousLockOn, setContinuousLockOn] = useState(false);
  const [lockPanelOpen, setLockPanelOpen] = useState(false);
  // Confirmed printed-marker edge length (m) — ARKit's metric scale reference. Loaded
  // from the device-global setting; the Stability panel lets the inspector confirm it.
  const [markerWidthM, setMarkerWidthM] = useState(MARKER_WIDTH_M);

  // ── Tool panels (mutually exclusive, like the Viro toolbar) ──
  // displayPanelOpen drives the single merged "Display" tab (surface colour-by +
  // see-through + edge overlay) — it replaced the old separate Edges + Color tabs.
  const [precisionMode, setPrecisionMode] = useState(false);
  const [displayPanelOpen, setDisplayPanelOpen] = useState(false);
  const [measurePanelOpen, setMeasurePanelOpen] = useState(false);
  const [qaPanelOpen, setQaPanelOpen] = useState(false);
  const [logFormOpen, setLogFormOpen] = useState(false);

  // ── Align (mirror the user transform JS-side for the readout + lock) ──
  const [userScale, setUserScale] = useState(1);
  const [locked, setLocked] = useState(false);

  // ── Edges ──
  const [renderMode, setRenderMode] = useState<RenderMode>('solid');
  const [edgeColor, setEdgeColor] = useState(DEFAULT_EDGE_COLOR);
  // Edge weight defaults to Fine and is adjusted via the Display panel's thickness
  // slider (no discrete presets).
  const [edgeWeight, setEdgeWeight] = useState(DEFAULT_EDGE_WEIGHT);
  const [pendingWireframe, setPendingWireframe] = useState(false);

  // ── Colour-by (Profile / Grade) — the SAME overlay as the web + 3D viewer.
  // Lives inside the merged Display panel now (no separate open-state). ──
  const [nodes, setNodes] = useState<MNode[]>([]);
  const [colorBy, setColorBy] = useState<ColorBy>(DEFAULT_COLOR_BY);

  // ── Measure ──
  const [measurements, setMeasurements] = useState<MeasurementState>(DEFAULT_MEASUREMENTS);
  const [renderScale, setRenderScale] = useState(1);
  const [measureMiss, setMeasureMiss] = useState(false);

  // ── Per-part QA tap ──
  const [partTapMode, setPartTapMode] = useState(false);

  // ── Point-pair registration (Phase 2) ──
  const [registerPanelOpen, setRegisterPanelOpen] = useState(false);
  const [registerPairs, setRegisterPairs] = useState<PointPair[]>([]);
  const [pendingModelPoint, setPendingModelPoint] = useState<Vec3 | null>(null);
  const [registerMiss, setRegisterMiss] = useState(false);
  const [lastRegRms, setLastRegRms] = useState<number | null>(null);

  // ── See-through overlay (Phase 3) — continuous opacity (1 = solid). Loads
  // semi-transparent (DEFAULT_MODEL_OPACITY) so the real part shows through for QA
  // overlay; raised to solid / fine-tuned from the Display panel's See-through
  // slider + the quick top-right "See-through" chip. ──
  const [opacity, setOpacity] = useState(DEFAULT_MODEL_OPACITY);

  // Brief "drag to move / twist to turn" hint shown right after placement.
  const [showDragHint, setShowDragHint] = useState(false);

  // ── QA capture (identical pipeline to the Viro path) ──
  const { user } = useAuth();
  const inspectorName =
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || undefined;
  const {
    entries: qualityEntries,
    loading: qualityLoading,
    pendingCount,
    create: createQuality,
    uploadEvidence,
    signoff: signoffQuality,
    flush: flushQueue,
  } = useQualityData(modelId);
  const [savingInspection, setSavingInspection] = useState(false);
  const [syncingQueue, setSyncingQueue] = useState(false);

  const flags = togglesToFlags(toggles);
  const dimensions = model.dimensions;

  // Colour-by is only meaningful with the project's node attributes — fetch them
  // (cache-first) when AR is opened in a project context. No projectId → no Color
  // tab (the overlay needs profile/grade per mesh).
  const projectId = qaContext?.projectId;
  useEffect(() => {
    if (!projectId) { setNodes([]); return; }
    let cancelled = false;
    projectsService.getNodes(projectId)
      .then((ns) => { if (!cancelled) setNodes(Array.isArray(ns) ? ns : []); })
      .catch(() => { /* keep empty — Color tab just won't show */ });
    return () => { cancelled = true; };
  }, [projectId]);

  // AUTHORITATIVE 1:1 scale: metres-per-GLB-unit recorded on the model at conversion
  // from the source file's real unit (IFC IfcUnitAssignment / glTF metres / OCCT mm).
  // This is exact and unit-system-agnostic (metric OR imperial), and arrives with the
  // model record — before first placement — so it replaces the fragile geometry guess.
  const [apiMetersPerUnit, setApiMetersPerUnit] = useState<number | null>(null);
  useEffect(() => {
    if (!modelId) { setApiMetersPerUnit(null); return; }
    let cancelled = false;
    modelsService.get(modelId)
      .then((m) => { if (!cancelled) setApiMetersPerUnit(typeof m.metersPerUnit === 'number' && Number.isFinite(m.metersPerUnit) && m.metersPerUnit > 0 ? m.metersPerUnit : null); })
      .catch(() => { if (!cancelled) setApiMetersPerUnit(null); /* fall back to the geometry estimate */ });
    return () => { cancelled = true; };
  }, [modelId]);

  // Display-unit preference (metric ↔ imperial) for measurement readouts — UI only;
  // geometry/scale + logged QA records stay metric. Persisted across sessions.
  const [unitSystem, setUnitSystem] = useState<UnitSystem>('metric');
  useEffect(() => { loadUnitSystem().then(setUnitSystem); }, []);
  const toggleUnitSystem = useCallback(() => {
    setUnitSystem((s) => { const next: UnitSystem = s === 'metric' ? 'imperial' : 'metric'; saveUnitSystem(next); return next; });
  }, []);

  // name(ifc_guid)→hex map + legend, scoped to the meshes actually shown (the
  // isolated set, or the whole model). Reuses buildColorBy verbatim, so AR matches
  // the web/3D-viewer colours exactly. The native overlay wants hex STRINGS.
  const colorResult = useMemo(
    () => buildColorBy(nodes, colorBy, meshNames ?? null),
    [nodes, colorBy, meshNames],
  );
  const colorByAvailable = nodes.length > 0;
  // The solid model is ALWAYS rendered (edges are a composite overlay on top), so
  // the colour overlay applies in BOTH view modes; only an empty map when off.
  const colorOverlay = useMemo(() => {
    if (colorBy === 'none') return {} as Record<string, string>;
    const out: Record<string, string> = {};
    for (const [name, intColor] of Object.entries(colorResult.colors)) {
      out[name] = `#${(intColor >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
    }
    return out;
  }, [colorBy, colorResult]);

  // TRUE 1:1 scale: metres-per-GLB-unit so the model renders at the real
  // assembly's size instead of a fixed 0.6 m. Resolved robustly from the GLB's own
  // geometry magnitude (the trustworthy signal — the converter writes native units
  // with no baked fit-scale) and REFINED by part-length calibration when the two
  // agree. 0 = undeterminable → the native view keeps its fit-scale. `source` tells
  // the inspector whether it's exact ('calibrated') or an auto estimate ('estimated').
  const realScaleResult = useMemo(() => {
    // Authoritative unit from the backend wins — it's exact and available immediately
    // (no wait for the background GLB dimension pass), so the FIRST placement is 1:1.
    if (apiMetersPerUnit && apiMetersPerUnit > 0) {
      return { mpu: apiMetersPerUnit, source: 'authoritative' as const };
    }
    if (!dimensions) return { mpu: 0, source: 'none' as const };
    const longest = Math.max(
      dimensions.overall.size[0],
      dimensions.overall.size[1],
      dimensions.overall.size[2],
    );
    return resolveRealScale(longest, dimensions.parts, nodes);
  }, [apiMetersPerUnit, dimensions, nodes]);
  const realScale = realScaleResult.mpu;

  // The active measurement tool, sent to the native view as a prop. 'off' when
  // the Measure panel is closed (so taps don't capture stray points).
  const measureMode: 'off' | 'model' | 'real' | 'deviation' = !measurePanelOpen
    ? 'off'
    : measurements.modelRulerActive
      ? 'model'
      : measurements.realRulerActive
        ? 'real'
        : measurements.deviationActive
          ? 'deviation'
          : 'off';

  // Direct manipulation is armed only when the model is placed, unlocked, and no
  // capture mode owns taps — so drag/twist never fights measure / part-pick / register.
  const directManip =
    placed && !locked && measureMode === 'off' && !partTapMode && !registerPanelOpen;

  // Which point the next register tap captures (native routes the tap accordingly).
  const registerMode: 'off' | 'model' | 'real' = !registerPanelOpen
    ? 'off'
    : pendingModelPoint
      ? 'real'
      : 'model';

  // Anything that actively moves / measures the model suppresses the continuous
  // auto-refine so the world-lock never fights the user mid-edit.
  const userInteracting =
    precisionMode || measurePanelOpen || registerPanelOpen || partTapMode;

  // The anti-drift brain: derives lock state + active marker for the HUD and drives
  // the continuous ICP world-lock (calls native refineLock on a throttle). The
  // per-frame marker pose drive itself is native. See useStabilizer / drift-monitor.
  const stabilizer = useStabilizer({
    arRef,
    placed,
    tracking,
    userInteracting,
    markerLockOn,
    continuousLockOn,
  });

  // Restore persisted marker bindings once the model is placed: a previously-aligned
  // assembly then re-locks the instant a known printed marker is re-detected, with no
  // re-alignment (FabStation's cached-marker-pose behaviour). Marker-relative offsets are
  // frame-independent, so this survives walk-away / backgrounding / app restart.
  const bindingsRestoredRef = useRef(false);
  useEffect(() => {
    if (!placed || bindingsRestoredRef.current) return;
    bindingsRestoredRef.current = true;
    (async () => {
      const saved = await loadMarkerBindings(modelId);
      if (saved) await arRef.current?.restoreMarkerBindings?.(saved);
    })();
  }, [placed, modelId]);

  // Bind to the visible markers, then read the (gated) bindings back and persist them.
  // If nothing met the bind-quality gate, coach the inspector to get a clean fix instead
  // of silently binding a poor marker (which would bake the error back in).
  const handleBind = useCallback(async () => {
    await arRef.current?.bindVisibleMarkers?.();
    try {
      const m = (await arRef.current?.getMarkerBindings?.()) ?? {};
      if (Object.keys(m).length === 0) {
        Alert.alert('Bind to marker', 'Move closer and square up to a printed marker, then Bind.');
        return;
      }
      await saveMarkerBindings(modelId, m);
    } catch {
      // best-effort persistence
    }
  }, [modelId]);

  const handleClearBindings = useCallback(async () => {
    stabilizer.clearBindings();
    await saveMarkerBindings(modelId, {});
  }, [stabilizer, modelId]);

  // Load the confirmed marker size once on mount; persist on change. A wrong size biases
  // every detected marker pose by the scale ratio, so this must match the printed sheet.
  useEffect(() => {
    (async () => setMarkerWidthM(await loadMarkerWidthM(MARKER_WIDTH_M)))();
  }, []);
  const handleSetMarkerWidth = useCallback((m: number) => {
    setMarkerWidthM(m);
    saveMarkerWidthM(m);
  }, []);

  // Live rigid-fit over the completed pairs (cheap for the handful of corners QA uses).
  const registerFit: RigidFit | null = useMemo(
    () => (registerPairs.length ? solveRigid(registerPairs) : null),
    [registerPairs],
  );

  const confidenceTag = useCallback((): string => {
    const f: string[] = [];
    if (lidar === false) f.push('no-LiDAR');
    if (tracking !== 'normal' && tracking !== 'starting') f.push(`tracking-${tracking}`);
    const low = f.length ? ` [low-confidence: ${f.join(', ')}]` : '';
    // Audit trail: stamp the last point-pair alignment quality onto AR QA records.
    const align = lastRegRms != null ? ` [aligned ±${lastRegRms.toFixed(1)}mm RMS]` : '';
    return low + align;
  }, [lidar, tracking, lastRegRms]);

  const partNames = dimensions ? dimensions.parts.map((p) => p.name) : [];

  const lastRulerMeters =
    measurements.modelRulerPoints.length === 2
      ? Math.hypot(
          measurements.modelRulerPoints[1][0] - measurements.modelRulerPoints[0][0],
          measurements.modelRulerPoints[1][1] - measurements.modelRulerPoints[0][1],
          measurements.modelRulerPoints[1][2] - measurements.modelRulerPoints[0][2],
        ) / (renderScale || 1)
      : null;

  // ── Native events ──
  const onTracking = useCallback((e: { nativeEvent: { state: string; lidar?: boolean } }) => {
    setTracking(e.nativeEvent.state);
    if (typeof e.nativeEvent.lidar === 'boolean') setLidar(e.nativeEvent.lidar);
  }, []);
  const onAnchor = useCallback(() => setPlaced(true), []);
  const onScanState = useCallback((e: { nativeEvent: { ready: boolean } }) => {
    setScanReady(!!e.nativeEvent.ready);
  }, []);
  const handlePlaceNow = useCallback(() => {
    arRef.current?.placeNow?.();
  }, []);
  const onError = useCallback((e: { nativeEvent: { message: string } }) => {
    setNativeError(e.nativeEvent.message);
  }, []);
  const onMeasure = useCallback(
    (e: { nativeEvent: { kind: string; points: Vec3[]; renderScale: number; miss?: boolean } }) => {
      const { kind, points, renderScale: rs, miss } = e.nativeEvent;
      if (typeof rs === 'number' && rs > 0) setRenderScale(rs);
      // A miss = no surface/model under the point (common when aiming a real-world
      // ruler at empty space). Surface a transient hint; leave the points as-is.
      setMeasureMiss(!!miss);
      if (miss) return;
      setMeasurements((m) => {
        if (kind === 'model') return { ...m, modelRulerPoints: points };
        if (kind === 'real') return { ...m, realRulerPoints: points };
        if (kind === 'deviation')
          return { ...m, deviationModelPoint: points[0] ?? null, deviationRealPoint: points[1] ?? null };
        return m;
      });
    },
    [],
  );

  // ── Reset measurements / transform when the model changes ──
  useEffect(() => {
    setMeasurements(DEFAULT_MEASUREMENTS);
    setRenderMode('solid');
    setUserScale(1);
    setLocked(false);
    setRegisterPanelOpen(false);
    setRegisterPairs([]);
    setPendingModelPoint(null);
    setRegisterMiss(false);
    setColorBy(DEFAULT_COLOR_BY);
    setDisplayPanelOpen(false);
    setOpacity(DEFAULT_MODEL_OPACITY);
    // Edge styling resets to defaults too (red, thin) so a switched-in model
    // loads with the same border look — not the previous model's customisation.
    setEdgeColor(DEFAULT_EDGE_COLOR);
    setEdgeWeight(DEFAULT_EDGE_WEIGHT);
    setPendingWireframe(false);
    // A new model re-enters the scan-before-place gate.
    setPlaced(false);
    setScanReady(false);
    // Tear down stale native markers from the previous model too (both sides reset).
    arRef.current?.clearRegistration?.();
    arRef.current?.clearMeasurement?.();
  }, [model.uri]);

  // Wireframe arrives on demand → switch into it if it was awaited.
  useEffect(() => {
    if (model.wireframeUri && pendingWireframe) {
      setRenderMode('wireframe');
      setPendingWireframe(false);
    }
  }, [model.wireframeUri, pendingWireframe]);

  // Tell the host when a docked panel is open (or the scan-before-place prompt is up)
  // so it can hide the bottom-center engine switcher and avoid overlap.
  const awaitingPlacement = model.phase === 'ready' && !placed;
  useEffect(() => {
    onChromeBusy?.(precisionMode || displayPanelOpen || measurePanelOpen || registerPanelOpen || lockPanelOpen || awaitingPlacement);
  }, [precisionMode, displayPanelOpen, measurePanelOpen, registerPanelOpen, lockPanelOpen, awaitingPlacement, onChromeBusy]);

  // Surface the drag/twist hint for a few seconds whenever the model (re)places.
  useEffect(() => {
    if (!placed) return;
    setShowDragHint(true);
    const t = setTimeout(() => setShowDragHint(false), 4500);
    return () => clearTimeout(t);
  }, [placed]);

  // Switching measurement tools wipes any stale captured points (the native view
  // clears its own geometry on the measureMode prop change).
  useEffect(() => {
    setMeasureMiss(false);
    setMeasurements((m) => ({
      ...m,
      modelRulerPoints: [],
      realRulerPoints: [],
      deviationModelPoint: null,
      deviationRealPoint: null,
    }));
  }, [measureMode]);

  // ── Align handlers (drive the native pivot via the view ref) ──
  const handleNudgePosition = useCallback((d: Vec3) => {
    arRef.current?.nudge?.(d[0], d[1], d[2]);
  }, []);
  const handleNudgeRotation = useCallback((d: Vec3) => {
    arRef.current?.rotateModel?.(d[0], d[1], d[2]);
  }, []);
  const handleQuickRotate = useCallback((deg: number) => {
    arRef.current?.rotateModel?.(0, deg, 0);
  }, []);
  const handleScaleBy = useCallback((factor: number) => {
    setUserScale((s) => Math.max(0.05, Math.min(20, s * factor)));
    arRef.current?.scaleModel?.(factor);
  }, []);
  const toggleLock = useCallback(() => {
    setLocked((l) => {
      const next = !l;
      arRef.current?.setModelLocked?.(next);
      return next;
    });
  }, []);
  const handleRecenter = useCallback(() => {
    arRef.current?.recenter?.();
    arRef.current?.clearMeasurement?.();
    setUserScale(1);
    setLocked(false);
    setMeasurements(DEFAULT_MEASUREMENTS);
    // The model moves on recenter → any captured registration pairs are now stale.
    setRegisterPairs([]);
    setPendingModelPoint(null);
    setRegisterMiss(false);
  }, []);

  // ── Edge-view handlers (reuse the on-demand wireframe GLB pipeline) ──
  const handleSelectView = useCallback(
    (mode: RenderMode) => {
      if (mode !== 'wireframe') {
        setRenderMode('solid');
        return;
      }
      // Edge view is refused for very large models (building it would crash the AR
      // view) — keep solid and say so instead of silently doing nothing.
      if (model.wireframeUnavailable) {
        setRenderMode('solid');
        notifyError();
        Alert.alert('Edges unavailable', 'This model is too large for the edge overlay — showing the solid view.');
        return;
      }
      if (model.wireframeUri) {
        setRenderMode('wireframe');
      } else {
        setPendingWireframe(true);
        if (!model.wireframeBusy) notifySuccess('Generating edges…');
      }
      model.requestWireframe(edgeWeight, edgeColor);
    },
    [model, edgeWeight, edgeColor],
  );
  const handleSelectColor = useCallback(
    (hex: string) => {
      setEdgeColor(hex);
      if (renderMode === 'wireframe') {
        setPendingWireframe(true);
        model.requestWireframe(edgeWeight, hex);
      }
    },
    [renderMode, model, edgeWeight],
  );
  const handleCommitWeight = useCallback(
    (weight: number) => {
      setEdgeWeight(weight);
      if (renderMode === 'wireframe') {
        setPendingWireframe(true);
        model.requestWireframe(weight, edgeColor);
      }
    },
    [renderMode, model, edgeColor],
  );

  // Edges ON by default: once the model is ready, switch into the (thinnest) edge
  // view automatically — done once per model. Skipped for models flagged too large
  // for the edge overlay (they stay solid; building edges would crash the AR view).
  const autoEdgesRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      model.phase === 'ready' &&
      model.uri &&
      !model.wireframeUnavailable &&
      autoEdgesRef.current !== model.uri
    ) {
      autoEdgesRef.current = model.uri;
      handleSelectView('wireframe');
    }
  }, [model.phase, model.uri, model.wireframeUnavailable, handleSelectView]);

  // If edges get refused mid-flight (the too-large flag flips after the first
  // attempt), fall back to the solid view so we never sit waiting on a wireframe.
  useEffect(() => {
    if (model.wireframeUnavailable) {
      setRenderMode('solid');
      setPendingWireframe(false);
    }
  }, [model.wireframeUnavailable]);

  // ── Measure handlers ──
  const updateMeasurements = useCallback((patch: Partial<MeasurementState>) => {
    setMeasurements((m) => ({ ...m, ...patch }));
  }, []);
  const clearRulers = useCallback(() => {
    arRef.current?.clearMeasurement?.();
    setMeasurements((m) => ({
      ...m,
      modelRulerPoints: [],
      realRulerPoints: [],
      deviationModelPoint: null,
      deviationRealPoint: null,
    }));
  }, []);
  const placePoint = useCallback(() => {
    arRef.current?.capturePoint?.();
  }, []);

  // ── QA ──
  const logPart = useCallback(
    async (meshName: string, status: 'pass' | 'fail' | 'warning') => {
      try {
        await createQuality({
          modelId,
          meshName,
          status,
          inspector: inspectorName,
          notes: `AR per-part inspection${confidenceTag()}`,
          ...qaContext,
        });
        notifySuccess(`${meshName}: ${status}`);
      } catch (e) {
        notifyError();
        Alert.alert('Could not save', e instanceof Error ? e.message : 'Failed to save result');
      }
    },
    [createQuality, modelId, inspectorName, confidenceTag, qaContext],
  );
  const onPartTap = useCallback(
    (e: { nativeEvent: { name: string } }) => {
      const meshName = e.nativeEvent.name || 'part';
      Alert.alert(meshName, 'Inspection result for this part?', [
        { text: 'Pass', onPress: () => void logPart(meshName, 'pass') },
        { text: 'Warning', onPress: () => void logPart(meshName, 'warning') },
        { text: 'Fail', style: 'destructive', onPress: () => void logPart(meshName, 'fail') },
        { text: 'Cancel', style: 'cancel' },
      ]);
    },
    [logPart],
  );

  // ── Point-pair registration handlers ──
  const onRegisterPoint = useCallback(
    (e: { nativeEvent: { space: 'model' | 'real'; point?: Vec3; miss?: boolean } }) => {
      const { space, point, miss } = e.nativeEvent;
      if (miss || !point) {
        setRegisterMiss(true);
        return;
      }
      setRegisterMiss(false);
      if (space === 'model') {
        setPendingModelPoint(point);
      } else if (space === 'real' && pendingModelPoint) {
        setRegisterPairs((prev) => [...prev, { model: pendingModelPoint, real: point }]);
        setPendingModelPoint(null);
      }
    },
    [pendingModelPoint],
  );

  const handleRegisterPlacePoint = useCallback(() => {
    arRef.current?.captureRegisterAtReticle?.();
  }, []);

  const handleRegisterUndo = useCallback(() => {
    arRef.current?.undoRegisterPair?.();
    setRegisterMiss(false);
    // Mirror the native undo: drop a half-finished model point first, else the last pair.
    if (pendingModelPoint) {
      setPendingModelPoint(null);
    } else {
      setRegisterPairs((prev) => prev.slice(0, -1));
    }
  }, [pendingModelPoint]);

  const handleRegisterClear = useCallback(() => {
    arRef.current?.clearRegistration?.();
    setRegisterPairs([]);
    setPendingModelPoint(null);
    setRegisterMiss(false);
  }, []);

  const handleApplyRegistration = useCallback(() => {
    if (!registerFit || !registerFit.ok || registerPairs.length < 1) return;
    arRef.current?.applyRegistration?.(registerFit.matrix);
    setLastRegRms(registerFit.rmsMm);
    setRegisterPairs([]);
    setPendingModelPoint(null);
    setRegisterMiss(false);
    notifySuccess(`Aligned · ${registerFit.rmsMm.toFixed(1)} mm RMS`);
  }, [registerFit, registerPairs.length]);

  // ── ICP auto-snap (Phase 3) ──
  const handleAutoSnap = useCallback(() => {
    arRef.current?.autoAlign?.();
  }, []);

  const onAutoAlign = useCallback(
    (e: { nativeEvent: { ok: boolean; rmsMm?: number; reason?: string; continuous?: boolean } }) => {
      const { ok, rmsMm, reason, continuous } = e.nativeEvent;
      // Feed every result (manual Auto-snap AND continuous world-lock) to the monitor.
      stabilizer.noteAutoAlign(e.nativeEvent);
      // The continuous world-lock runs silently — no toasts/alerts every couple seconds.
      if (continuous) return;
      if (ok) {
        if (typeof rmsMm === 'number') setLastRegRms(rmsMm);
        notifySuccess(`Auto-snapped${rmsMm != null ? ` · ${rmsMm.toFixed(1)} mm RMS` : ''}`);
        return;
      }
      const msg =
        reason === 'sparse-mesh' || reason === 'low-overlap'
          ? 'Not enough scanned surface near the model — move around it to scan more, then try again.'
          : reason === 'no-lidar'
            ? 'Auto-snap needs a LiDAR sensor.'
            : reason === 'no-improvement'
              ? 'Already well aligned — no further improvement found.'
              : reason === 'not-placed'
                ? 'Place the model first.'
                : 'Could not auto-snap.';
      notifyError();
      Alert.alert('Auto-snap', msg);
    },
    [stabilizer.noteAutoAlign],
  );

  // Apply the see-through overlay opacity whenever it changes.
  useEffect(() => {
    arRef.current?.setModelOpacity?.(opacity);
  }, [opacity]);

  const handleLogDeviation = useCallback(async () => {
    const a = measurements.deviationModelPoint;
    const b = measurements.deviationRealPoint;
    if (!a || !b) return;
    const mm = Math.round(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 1000 * 10) / 10;
    try {
      await createQuality({
        modelId,
        meshName: 'deviation-probe',
        status: 'warning',
        inspector: inspectorName,
        measurementValue: mm,
        measurementUnit: 'mm',
        notes: `AR deviation probe${confidenceTag()}`,
        ...qaContext,
      });
      clearRulers();
      notifySuccess();
      Alert.alert('Logged', `Deviation of ${mm} mm recorded.`);
    } catch (e) {
      notifyError();
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Failed to save deviation');
    }
  }, [measurements.deviationModelPoint, measurements.deviationRealPoint, createQuality, modelId, inspectorName, confidenceTag, qaContext, clearRulers]);

  const handleCaptureEvidence = useCallback(
    async (entry: ARQualityEntry) => {
      const snap = await captureNativeSnapshot(arRef);
      if (!snap) {
        Alert.alert('Capture unavailable', 'Could not capture the AR view on this device.');
        return;
      }
      try {
        await uploadEvidence(entry.id, snap.uri);
        Alert.alert('Evidence attached', 'AR snapshot saved to the inspection.');
      } catch (e) {
        Alert.alert('Upload failed', e instanceof Error ? e.message : 'Could not upload evidence');
      }
    },
    [uploadEvidence],
  );

  const handleSignoff = useCallback(
    (entry: ARQualityEntry) => {
      if (!can('quality-analysis.signoff')) {
        Alert.alert('Sign-off', 'Your role cannot approve/reject inspections — a reviewer with sign-off permission will pick this up.');
        return;
      }
      Alert.alert(`Sign off — ${entry.meshName}`, `Current status: ${entry.status.toUpperCase()}`, [
        { text: 'Approve', onPress: () => void signoffQuality(entry.id, 'approved') },
        { text: 'Reject', style: 'destructive', onPress: () => void signoffQuality(entry.id, 'rejected') },
        { text: 'Cancel', style: 'cancel' },
      ]);
    },
    [signoffQuality],
  );

  const handleLogInspection = useCallback(
    async (result: InspectionFormResult) => {
      setSavingInspection(true);
      try {
        await createQuality({ modelId, inspector: inspectorName, ...qaContext, ...result });
        setLogFormOpen(false);
        notifySuccess(offlineService.isOnline ? 'Inspection logged' : 'Saved offline — will sync');
      } catch (e) {
        notifyError();
        Alert.alert('Could not save', e instanceof Error ? e.message : 'Failed to save inspection');
      } finally {
        setSavingInspection(false);
      }
    },
    [createQuality, modelId, inspectorName, qaContext],
  );

  const handleSyncQueue = useCallback(async () => {
    if (syncingQueue) return;
    if (!offlineService.isOnline) {
      Alert.alert('Still offline', `${pendingCount} inspection${pendingCount === 1 ? '' : 's'} saved on this device — they'll upload automatically when you're back online.`);
      return;
    }
    setSyncingQueue(true);
    try {
      const { synced, failed } = await flushQueue();
      if (failed > 0) Alert.alert('Some items could not sync', `${synced} uploaded, ${failed} could not be saved.`);
      else if (synced > 0) Alert.alert('Synced', `${synced} queued inspection${synced === 1 ? '' : 's'} uploaded.`);
    } catch {
      Alert.alert("Couldn't sync", "We couldn't reach the server. Your inspections stay queued and will retry automatically.");
    } finally {
      setSyncingQueue(false);
    }
  }, [syncingQueue, pendingCount, flushQueue]);

  // ── Tool toggles (mutually exclusive bottom panels) ──
  // Closing/leaving the register flow clears its captured points + native markers.
  const closeRegister = useCallback(() => {
    setRegisterPanelOpen((open) => {
      if (open) {
        arRef.current?.clearRegistration?.();
        setRegisterPairs([]);
        setPendingModelPoint(null);
        setRegisterMiss(false);
      }
      return false;
    });
  }, []);
  const togglePrecision = useCallback(() => {
    setPrecisionMode((p) => !p);
    setDisplayPanelOpen(false);
    setMeasurePanelOpen(false);
    setLockPanelOpen(false);
    closeRegister();
  }, [closeRegister]);
  const toggleDisplay = useCallback(() => {
    const opening = !displayPanelOpen;
    setDisplayPanelOpen(opening);
    setPrecisionMode(false);
    setMeasurePanelOpen(false);
    setLockPanelOpen(false);
    closeRegister();
    // Opening the Display tab turns the edge overlay ON by default.
    if (opening && renderMode !== 'wireframe') handleSelectView('wireframe');
  }, [displayPanelOpen, renderMode, handleSelectView, closeRegister]);
  const toggleMeasure = useCallback(() => {
    setMeasurePanelOpen((m) => !m);
    setPrecisionMode(false);
    setDisplayPanelOpen(false);
    setLockPanelOpen(false);
    closeRegister();
  }, [closeRegister]);
  const toggleRegister = useCallback(() => {
    setRegisterPanelOpen((open) => {
      // Start a fresh capture set each time it opens; clear on close too.
      arRef.current?.clearRegistration?.();
      setRegisterPairs([]);
      setPendingModelPoint(null);
      setRegisterMiss(false);
      return !open;
    });
    setPrecisionMode(false);
    setDisplayPanelOpen(false);
    setMeasurePanelOpen(false);
    setLockPanelOpen(false);
    setPartTapMode(false); // register taps must not also fire part-pick
  }, []);

  // Stability / anti-drift tab.
  const toggleLockPanel = useCallback(() => {
    setLockPanelOpen((o) => !o);
    setPrecisionMode(false);
    setDisplayPanelOpen(false);
    setMeasurePanelOpen(false);
    closeRegister();
  }, [closeRegister]);

  const handlePrintMarkers = useCallback(async () => {
    try {
      const base64 = await arRef.current?.exportMarkerSheet?.();
      if (!base64) {
        Alert.alert('Markers', 'Could not generate the marker sheet on this device.');
        return;
      }
      // Write the PNG to cache + hand it to the iOS share sheet (AirPrint / Save to
      // Files). Print at 100% (1:1) so the printed edge matches MARKER_WIDTH_M.
      const dir = `${FileSystem.cacheDirectory}pcs-ar-markers/`;
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
      const uri = `${dir}pcs-ar-markers.png`;
      await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
      await Share.share({ url: uri, title: 'PCS AR markers' });
    } catch {
      notifyError();
      Alert.alert('Markers', 'Could not export the marker sheet.');
    }
  }, []);
  // Colour-by paints the solid, which is shown in BOTH view modes (in edges view
  // the outlines sit on top of the coloured solid), so no view switch is needed.
  const handleColorBy = useCallback((by: ColorBy) => {
    setColorBy(by);
  }, []);

  const downloading = model.phase !== 'ready' && model.phase !== 'error';
  const showReticle =
    measurePanelOpen &&
    placed &&
    (measurements.realRulerActive ||
      (measurements.deviationActive && !!measurements.deviationModelPoint && !measurements.deviationRealPoint));

  return (
    <View style={styles.container}>
      <PcsLidarArView
        ref={arRef}
        style={StyleSheet.absoluteFill}
        modelUri={model.uri ?? undefined}
        wireframeUri={model.wireframeUri ?? undefined}
        showEdges={renderMode === 'wireframe'}
        edgeColor={edgeColor}
        colorOverlay={colorOverlay}
        realScale={realScale}
        manualPlacement
        markerLock={markerLockOn}
        markerWidthMeters={markerWidthM}
        directManipulation={directManip}
        registerMode={registerMode}
        occlusion={flags.occlusion}
        personSegmentation={flags.personSegmentation}
        physics={flags.physics}
        planeAnchor={flags.planeAnchor}
        showMesh={flags.showMesh}
        measureMode={measureMode}
        partPick={partTapMode}
        showOverallBox={measurements.showOverall}
        showPartBoxes={measurements.showParts}
        onTracking={onTracking}
        onAnchor={onAnchor}
        onScanState={onScanState}
        onError={onError}
        onMeasure={onMeasure as any}
        onPartTap={onPartTap as any}
        onRegisterPoint={onRegisterPoint as any}
        onAutoAlign={onAutoAlign as any}
        onMarkerUpdate={stabilizer.onMarkerUpdate as any}
        onLockStatus={stabilizer.onLockStatus as any}
      />

      {/* Header — Back + assembly name on the left, Records + Occlusion on the right */}
      <TouchableOpacity style={styles.backButton} onPress={onBack}>
        <Text style={styles.backButtonText}>{'< Back'}</Text>
      </TouchableOpacity>

      {/* Assembly name + tracking, docked BELOW the Back button (left-aligned) */}
      <View style={styles.nameBlock} pointerEvents="none">
        <Text style={styles.titleText} numberOfLines={1}>
          {partLabel || fileName}
        </Text>
        <Text style={styles.subText} numberOfLines={1}>
          {lidar === false ? 'LiDAR unavailable' : `tracking: ${tracking}`}
          {realScale > 0
            ? realScaleResult.source === 'authoritative'
              ? '  ·  1:1 scale'
              : realScaleResult.source === 'calibrated'
                ? '  ·  1:1 (calibrated)'
                : '  ·  ≈1:1 (auto)'
            : ''}
          {placed && (markerLockOn || continuousLockOn)
            ? `  ·  ${lockStateLabel(stabilizer.lockState)}`
            : ''}
        </Text>
      </View>

      {onViewRecords && (
        <TouchableOpacity style={styles.recordsButton} onPress={onViewRecords}>
          <Text style={styles.recordsButtonText}>Records</Text>
        </TouchableOpacity>
      )}

      {/* Re-aim prompt — the model has been uncorrected past the failure threshold with
          marker lock armed; aiming at a printed marker re-locks it (drift-free). */}
      {placed && markerLockOn && stabilizer.needsReaim && (
        <View style={styles.reaimBanner} pointerEvents="none">
          <Text style={styles.reaimBannerText}>Aim at a printed marker to re-lock the model</Text>
        </View>
      )}

      {/* Far-from-origin precision guard — tapping re-bases the AR world origin at the
          part so coordinates stay small/precise on a large assembly (marker lock survives). */}
      {placed && stabilizer.farFromOrigin && (
        <TouchableOpacity
          style={styles.farOriginBanner}
          onPress={() => arRef.current?.recenterWorldOrigin?.()}
          activeOpacity={0.85}
        >
          <Text style={styles.reaimBannerText}>Far from start point — tap to re-center for precision</Text>
        </TouchableOpacity>
      )}

      {/* Quick toggles — top-right, off-centre: Occlusion, then See-through.
          (The Edges quick toggle was removed — edges live in the Display tab.) */}
      <View style={styles.occlusionWrap} pointerEvents="box-none">
        <ToggleChip
          icon="👁"
          label="Occlusion"
          on={toggles.occlusion}
          onPress={() => setToggles((t) => ({ occlusion: !t.occlusion }))}
        />
        {placed && (
          <ToggleChip
            icon="◐"
            label="See-through"
            on={opacity < 0.999}
            onPress={() => setOpacity((o) => (o < 0.999 ? 1 : DEFAULT_MODEL_OPACITY))}
          />
        )}
      </View>

      {/* Loading pill over the live camera */}
      {downloading && (
        <View style={styles.pillWrap} pointerEvents="none">
          <View style={styles.pill}>
            <ActivityIndicator size="small" color="#fff" />
            <Text style={styles.pillText}>{model.progress ?? 'Loading…'}</Text>
          </View>
        </View>
      )}

      {/* Scan-before-place: map the area first, then drop the model where you aim.
          Scanning builds ARKit's world map so the placed model tracks stably (it does
          NOT change scale — that's already 1:1 from the geometry). A centre reticle
          shows where it will land; the button enables once tracking is solid. */}
      {model.phase === 'ready' && !placed && (
        <>
          <View style={styles.reticleWrap} pointerEvents="none">
            <View style={styles.reticle}>
              <View style={[styles.reticleRing, scanReady && styles.reticleRingReady]} />
              <View style={styles.reticleDot} />
            </View>
          </View>
          <View style={styles.scanWrap} pointerEvents="box-none">
            <Text style={styles.scanTitle}>
              {scanReady ? '✓ Area mapped' : 'Scan the area'}
            </Text>
            <Text style={styles.scanHint}>
              {scanReady
                ? 'Aim the circle where the assembly sits, then place the model.'
                : 'Move the iPad slowly around the spot — pan across the floor and the real assembly so it maps in 3D.'}
            </Text>
            <TouchableOpacity
              style={[styles.placeModelBtn, (!scanReady && tracking !== 'normal') && styles.placeModelBtnDisabled]}
              onPress={handlePlaceNow}
              disabled={!scanReady && tracking !== 'normal'}
              activeOpacity={0.85}
            >
              <Text style={styles.placeModelBtnText}>
                {scanReady || tracking === 'normal' ? '＋ Place model here' : 'Scanning…'}
              </Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* Banner stack: no-LiDAR + tracking state */}
      <View style={styles.bannerStack} pointerEvents="box-none">
        {Platform.OS === 'ios' && lidar === false && !capWarningDismissed && (
          <View style={[styles.banner, styles.bannerWarn]}>
            <Text style={styles.bannerText}>
              No LiDAR on this device — occlusion + real-world measurements are approximate.
            </Text>
            <TouchableOpacity style={styles.bannerDismiss} onPress={() => setCapWarningDismissed(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.bannerDismissText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
        {tracking === 'limited' && (
          <View style={[styles.banner, styles.bannerWarn]}>
            <Text style={styles.bannerText}>Tracking limited — move the iPad slowly in a well-lit area.</Text>
          </View>
        )}
        {tracking === 'unavailable' && (
          <View style={[styles.banner, styles.bannerWarn]}>
            <Text style={styles.bannerText}>Tracking unavailable — check lighting and keep textured surroundings in view.</Text>
          </View>
        )}
      </View>

      {/* Right rail: part-tap QA toggle + re-center (when placed) */}
      {placed && !measurePanelOpen && !registerPanelOpen && (
        <View style={styles.vizRail} pointerEvents="box-none">
          <TouchableOpacity
            style={[styles.vizButton, partTapMode && styles.vizButtonActive]}
            onPress={() => setPartTapMode((p) => !p)}
            activeOpacity={0.7}
          >
            <Text style={styles.vizButtonText}>{partTapMode ? '◉ Tap-QA on' : '◎ Tap a part'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.vizButton} onPress={handleRecenter} activeOpacity={0.7}>
            <Text style={styles.vizButtonText}>⟲ Re-center</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Elevation handle — quick height for direct manipulation (no panel open).
          Uses nudgeWorld so height tracks true world-up even on a tilted anchor. */}
      {directManip && !precisionMode && !displayPanelOpen && !measurePanelOpen && (
        <ElevationHandle onStep={(dy) => arRef.current?.nudgeWorld?.(0, dy, 0)} />
      )}

      {/* Brief drag/twist hint after placement */}
      {showDragHint && directManip && !precisionMode && !displayPanelOpen && !measurePanelOpen && (
        <View style={styles.dragHintWrap} pointerEvents="none">
          <Text style={styles.dragHintText}>✋ Drag to move  ·  ↻ twist to turn  ·  ▲▼ height</Text>
        </View>
      )}

      {/* Offline-queue sync pill */}
      {!precisionMode && !displayPanelOpen && !measurePanelOpen && pendingCount > 0 && (
        <View style={styles.bottomCenter} pointerEvents="box-none">
          <TouchableOpacity
            style={[styles.queueChip, syncingQueue && styles.queueChipBusy]}
            onPress={handleSyncQueue}
            disabled={syncingQueue}
            activeOpacity={0.8}
            hitSlop={{ top: 10, bottom: 10, left: 16, right: 16 }}
          >
            {syncingQueue ? <ActivityIndicator size="small" color="#0b1220" /> : <Text style={styles.queueChipIcon}>⟳</Text>}
            <Text style={styles.queueChipText}>
              {syncingQueue ? 'Syncing…' : `${pendingCount} queued offline · tap to sync`}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Align panel — docked low (the toolbar lives on the right rail now) */}
      {precisionMode && placed && (
        <AlignPanel
          scale={[userScale, userScale, userScale]}
          locked={locked}
          onNudgePosition={handleNudgePosition}
          onNudgeRotation={handleNudgeRotation}
          onScaleBy={handleScaleBy}
          onQuickRotate={handleQuickRotate}
          onToggleLock={toggleLock}
          bottomOffset={PANEL_BOTTOM}
          translucent
          onAutoSnap={handleAutoSnap}
        />
      )}

      {/* Display panel — the merged appearance tab: surface colour-by +
          see-through + the edge overlay (was the separate Edges + Color tabs). */}
      {displayPanelOpen && placed && (
        <AppearancePanel
          renderMode={renderMode}
          onSelectView={handleSelectView}
          edgeColor={edgeColor}
          edgeWeight={edgeWeight}
          edgesBusy={model.wireframeBusy}
          onSelectColor={handleSelectColor}
          onCommitWeight={handleCommitWeight}
          colorByAvailable={colorByAvailable}
          colorBy={colorBy}
          legend={colorResult.legend}
          onColorBy={handleColorBy}
          opacity={opacity}
          onOpacity={setOpacity}
          bottomOffset={PANEL_BOTTOM}
          translucent
        />
      )}

      {/* Measurement panel */}
      {measurePanelOpen && placed && (
        <MeasurementPanel
          measurements={measurements}
          dimensions={dimensions}
          modelScale={renderScale}
          onChange={updateMeasurements}
          onClearRulers={clearRulers}
          onLogDeviation={handleLogDeviation}
          bottomOffset={PANEL_BOTTOM}
          translucent
          unitSystem={unitSystem}
          onToggleUnitSystem={toggleUnitSystem}
        />
      )}

      {/* Register (point-pair) panel + a centre reticle to aim the Place-point button */}
      {registerPanelOpen && placed && (
        <>
          <View style={styles.reticleWrap} pointerEvents="none">
            <View style={styles.reticle}>
              <View style={styles.reticleRing} />
              <View style={styles.reticleDot} />
            </View>
          </View>
          <RegisterPanel
            pairCount={registerPairs.length}
            awaitingReal={!!pendingModelPoint}
            fit={registerFit}
            miss={registerMiss}
            onPlacePoint={handleRegisterPlacePoint}
            onUndo={handleRegisterUndo}
            onClear={handleRegisterClear}
            onApply={handleApplyRegistration}
            bottomOffset={PANEL_BOTTOM}
            translucent
          />
        </>
      )}

      {/* Stability / anti-drift panel (marker lock + continuous world-lock) */}
      {lockPanelOpen && placed && (
        <LockPanel
          bottom={PANEL_BOTTOM}
          markerLockOn={markerLockOn}
          continuousLockOn={continuousLockOn}
          lockState={stabilizer.lockState}
          activeMarker={stabilizer.activeMarker}
          trackedCount={stabilizer.trackedCount}
          boundCount={stabilizer.boundCount}
          markerVisible={stabilizer.markerVisible}
          holding={stabilizer.holding}
          lastResidualMm={stabilizer.lastResidualMm}
          markerWidthM={markerWidthM}
          onSetMarkerWidth={handleSetMarkerWidth}
          onToggleMarkerLock={() => setMarkerLockOn((v) => !v)}
          onToggleContinuousLock={() => setContinuousLockOn((v) => !v)}
          onBind={handleBind}
          onClearBindings={handleClearBindings}
          onPrintMarkers={handlePrintMarkers}
        />
      )}

      {/* Aim reticle + "Place point" for real-world / deviation-real points */}
      {showReticle && (
        <View style={styles.reticleWrap} pointerEvents="box-none">
          <View style={styles.reticle} pointerEvents="none">
            <View style={styles.reticleRing} />
            <View style={styles.reticleDot} />
          </View>
          {measureMiss && (
            <View style={styles.missHint} pointerEvents="none">
              <Text style={styles.missHintText}>No surface under the reticle — re-aim at the part/floor</Text>
            </View>
          )}
          <TouchableOpacity style={styles.placeButton} onPress={placePoint} activeOpacity={0.85}>
            <Text style={styles.placeButtonText}>＋ Place point</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Toolbar — vertical rail on the RIGHT so the model keeps the bottom + middle */}
      <ToolBar
        placed={placed}
        modelLoaded={!!model.uri}
        precisionMode={precisionMode}
        edgesPanelOpen={displayPanelOpen}
        measurePanelOpen={measurePanelOpen}
        onTogglePrecision={togglePrecision}
        onToggleEdges={toggleDisplay}
        onToggleMeasure={toggleMeasure}
        appearanceLabel="Display"
        appearanceIcon="◑"
        registerPanelOpen={registerPanelOpen}
        onToggleRegister={toggleRegister}
        lockPanelOpen={lockPanelOpen}
        onToggleLock={toggleLockPanel}
        side="right"
      />

      {/* QA panel toggle */}
      {placed && (
        <TouchableOpacity style={styles.qaButton} onPress={() => setQaPanelOpen((o) => !o)} activeOpacity={0.7}>
          <Text style={styles.qaButtonText}>{qaPanelOpen ? 'Close QA' : 'QA'}</Text>
        </TouchableOpacity>
      )}
      {placed && qaPanelOpen && (
        <QualityPanel
          entries={qualityEntries}
          loading={qualityLoading}
          onClose={() => setQaPanelOpen(false)}
          onLogNew={() => setLogFormOpen(true)}
          onSignoff={handleSignoff}
          onCaptureEvidence={handleCaptureEvidence}
        />
      )}

      {/* Log-inspection modal */}
      <LogInspectionForm
        visible={logFormOpen}
        partNames={partNames}
        defaultMeasurement={lastRulerMeters}
        submitting={savingInspection}
        onSubmit={handleLogInspection}
        onCancel={() => setLogFormOpen(false)}
      />

      {/* Error card */}
      {(model.error || nativeError) && (
        <View style={styles.errWrap} pointerEvents="box-none">
          <Text style={styles.errText}>{model.error ?? nativeError}</Text>
          {model.error && (
            <TouchableOpacity style={styles.errBtn} onPress={model.retry}>
              <Text style={styles.errBtnText}>Retry</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 16,
    backgroundColor: 'rgba(13, 17, 23, 0.85)',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    zIndex: 20,
  },
  backButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  // Assembly name + tracking, left-aligned just under the Back button.
  nameBlock: { position: 'absolute', top: 90, left: 16, right: 160, zIndex: 10 },
  titleText: { color: '#fff', fontSize: 15, fontWeight: '800', maxWidth: '100%' },
  subText: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '600', marginTop: 1 },
  recordsButton: {
    position: 'absolute',
    top: 50,
    right: 16,
    backgroundColor: 'rgba(13, 17, 23, 0.85)',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    zIndex: 20,
  },
  recordsButtonText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  occlusionWrap: { position: 'absolute', top: 92, right: 16, alignItems: 'flex-end', gap: 8, zIndex: 24 },
  pillWrap: { position: 'absolute', top: 150, left: 0, right: 0, alignItems: 'center', zIndex: 16 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(13, 17, 23, 0.85)',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 22,
  },
  pillText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  hintWrap: { position: 'absolute', bottom: 130, left: 24, right: 24, alignItems: 'center', zIndex: 16 },
  hintText: {
    color: '#0b1220',
    backgroundColor: 'rgba(255,255,255,0.92)',
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    overflow: 'hidden',
  },
  bannerStack: { position: 'absolute', top: 200, left: 16, right: 16, zIndex: 15, gap: 8 },
  banner: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12 },
  bannerWarn: { backgroundColor: 'rgba(234, 179, 8, 0.92)' },
  bannerText: { flex: 1, color: '#1f2937', fontSize: 14, fontWeight: '700' },
  bannerDismiss: { marginLeft: 10, paddingHorizontal: 4 },
  bannerDismissText: { color: '#1f2937', fontSize: 15, fontWeight: '800' },
  // Left edge, below the QA button — keeps the RIGHT edge clear for the toolbar rail.
  vizRail: { position: 'absolute', left: 12, top: 206, gap: 8, zIndex: 18 },
  // Height control, vertically centred on the left edge (clear of the viz rail above
  // and the docked panels below). pointerEvents box-none so only the buttons capture.
  elevHandle: { position: 'absolute', left: 14, top: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', gap: 6, zIndex: 19 },
  elevBtn: { width: 50, height: 50, borderRadius: 25, backgroundColor: 'rgba(13, 17, 23, 0.85)', alignItems: 'center', justifyContent: 'center' },
  elevGlyph: { color: '#fff', fontSize: 20, fontWeight: '800' },
  elevLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 10, fontWeight: '700' },
  dragHintWrap: { position: 'absolute', bottom: 130, left: 24, right: 24, alignItems: 'center', zIndex: 16 },
  dragHintText: {
    color: '#0b1220',
    backgroundColor: 'rgba(255,255,255,0.92)',
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    overflow: 'hidden',
  },
  vizButton: {
    backgroundColor: 'rgba(13, 17, 23, 0.85)',
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 20,
    minWidth: 120,
    alignItems: 'center',
  },
  vizButtonActive: { backgroundColor: 'rgba(14, 165, 233, 0.92)' },
  vizButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  bottomCenter: { position: 'absolute', bottom: 92, left: 0, right: 0, alignItems: 'center', gap: 6, zIndex: 15 },
  queueChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    backgroundColor: 'rgba(245, 158, 11, 0.97)',
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 22,
  },
  queueChipBusy: { backgroundColor: 'rgba(245, 158, 11, 0.75)' },
  queueChipIcon: { color: '#0b1220', fontSize: 18, fontWeight: '900' },
  queueChipText: { color: '#0b1220', fontSize: 15, fontWeight: '800' },
  reticleWrap: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', zIndex: 30 },
  reticle: { alignItems: 'center', justifyContent: 'center' },
  missHint: {
    position: 'absolute',
    top: '38%',
    backgroundColor: 'rgba(234, 179, 8, 0.95)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    maxWidth: '80%',
  },
  missHintText: { color: '#1f2937', fontSize: 13, fontWeight: '700', textAlign: 'center' },
  // Re-aim prompt banner — top-centre, amber, when the lock is holding past the failure
  // threshold (mirrors the missHint look so the AR HUD stays visually consistent).
  reaimBanner: {
    position: 'absolute',
    top: '12%',
    alignSelf: 'center',
    backgroundColor: 'rgba(234, 179, 8, 0.95)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    maxWidth: '80%',
    zIndex: 32,
  },
  reaimBannerText: { color: '#1f2937', fontSize: 13, fontWeight: '700', textAlign: 'center' },
  // Far-from-origin precision warning — sits below the re-aim banner, tappable to re-center.
  farOriginBanner: {
    position: 'absolute',
    top: '18%',
    alignSelf: 'center',
    backgroundColor: 'rgba(234, 179, 8, 0.95)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    maxWidth: '80%',
    zIndex: 32,
  },
  reticleRing: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)', backgroundColor: 'rgba(0,0,0,0.05)' },
  reticleRingReady: { borderColor: 'rgba(34, 197, 94, 0.95)', backgroundColor: 'rgba(34, 197, 94, 0.12)' },
  reticleDot: { position: 'absolute', width: 6, height: 6, borderRadius: 3, backgroundColor: '#0ea5e9' },
  // Scan-before-place prompt + action, docked low so the reticle/area stays clear.
  scanWrap: { position: 'absolute', bottom: 56, left: 24, right: 24, alignItems: 'center', zIndex: 31 },
  scanTitle: { color: '#fff', fontSize: 17, fontWeight: '800', marginBottom: 4, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  scanHint: {
    color: '#0b1220',
    backgroundColor: 'rgba(255,255,255,0.92)',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 12,
  },
  placeModelBtn: {
    minHeight: 48,
    justifyContent: 'center',
    backgroundColor: 'rgba(14, 165, 233, 0.97)',
    paddingVertical: 13,
    paddingHorizontal: 34,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: '#fff',
  },
  placeModelBtnDisabled: { backgroundColor: 'rgba(100, 116, 139, 0.85)', borderColor: 'rgba(255,255,255,0.4)' },
  placeModelBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  placeButton: {
    marginTop: 76,
    backgroundColor: 'rgba(14, 165, 233, 0.97)',
    paddingVertical: 13,
    paddingHorizontal: 30,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: '#fff',
  },
  placeButtonText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  qaButton: {
    position: 'absolute',
    top: 150,
    left: 16,
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: 'rgba(59, 130, 246, 0.92)',
    paddingVertical: 11,
    paddingHorizontal: 20,
    borderRadius: 22,
    zIndex: 25,
  },
  qaButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  errWrap: { position: 'absolute', top: 150, left: 16, right: 16, alignItems: 'center', zIndex: 30 },
  errText: {
    color: '#fff',
    backgroundColor: 'rgba(220, 38, 38, 0.92)',
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    overflow: 'hidden',
    textAlign: 'center',
  },
  errBtn: { marginTop: 8, backgroundColor: '#1565c0', paddingVertical: 8, paddingHorizontal: 20, borderRadius: 10 },
  errBtnText: { color: '#fff', fontWeight: '800' },
});
