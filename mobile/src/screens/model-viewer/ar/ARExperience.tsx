// AR QA Inspector — the camera-first experience controller + HUD.
//
// Design (the rewrite's core): the Viro AR navigator is mounted ONCE, the moment
// this component mounts, so the real camera feed is live immediately. The model
// is downloaded IN THE BACKGROUND by useRemoteModel and streamed into the scene
// when ready; while it loads we show a small pill over the live camera (never a
// black "preparing" screen). When the GLB is ready the scene auto-places it in
// front of the camera, auto-fits its scale, and fades it in.
//
// The navigator is never re-keyed — remounting it tears down the GLSurfaceView
// on the GL thread and crashes (onSurfaceChanged NPE / shader SIGSEGV). Tracking
// mode changes are applied as a live preset (worldAlignment + anchorDetection),
// never a scene-graph swap.
import React, { useRef, useCallback, useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  Alert,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { offlineService } from '../../../services/offline.service';
import { notifySuccess, notifyError } from '../../../utils/feedback';
import ARModelScene from './ARModelScene';
import ToolBar from './ToolBar';
import ToggleChip from './ToggleChip';
import TrackingModeSwitcher from './TrackingModeSwitcher';
import MeasurementPanel from './MeasurementPanel';
import AlignPanel from './AlignPanel';
import EdgesPanel from './EdgesPanel';
import QualityPanel from './QualityPanel';
import LogInspectionForm, { InspectionFormResult } from './LogInspectionForm';
import { useModelState } from './useModelState';
import { useDeviceCapabilities } from './useDeviceCapabilities';
import { useQualityData, ARQualityEntry } from './useQualityData';
import { useRemoteModel } from './useRemoteModel';
import { useAuth } from '../../../context/AuthContext';
import { can } from '../../../config/permissions';
import {
  Vec3,
  RenderMode,
  TrackingMode,
  MeasurementState,
  DEFAULT_MEASUREMENTS,
  DEFAULT_EDGE_COLOR,
  DEFAULT_EDGE_WEIGHT,
} from './types';
import { captureSnapshot } from './arSnapshot';
import { loadRegistration, saveRegistration } from './arRegistration';

// Lazy-load the Viro navigator — static import crashes in Expo Go.
let ViroARSceneNavigator: any = null;
try {
  ViroARSceneNavigator = require('@reactvision/react-viro').ViroARSceneNavigator;
} catch {
  // handled by the host screen
}

// Tool panels dock LOW (the Align/Edges/Measure toolbar lives on the right rail)
// so the model keeps the bottom + middle of the screen.
const PANEL_BOTTOM = 28;

interface ARExperienceProps {
  modelId: string;
  /** Authed backend URL of the GLB (loaded by this component, not the host). */
  fileUrl: string;
  fileName?: string;
  /** When set, only these part(s) are isolated + shown. */
  meshNames?: string[] | null;
  partLabel?: string | null;
  /** Mode the session opens in; switchable live in-AR. */
  initialTrackingMode: TrackingMode;
  /** Fabrication context — when AR is opened from an assembly's stage, every
   *  inspection logged here is tagged to that operation (so a hold point gates
   *  the stage and the result rolls up to Final QC). Omitted = model-only AR. */
  qaContext?: { assemblyNodeId?: string; projectId?: string; stageId?: string; workOrderStageId?: string };
  /** Open the (non-AR) Quality records viewer for this model. */
  onViewRecords?: () => void;
  onBack: () => void;
  /** Notifies the host that a docked tool panel is open, so it can hide the
   *  bottom engine switcher (which would otherwise sit under the low panel). */
  onChromeBusy?: (busy: boolean) => void;
}

export default function ARExperience({
  modelId,
  fileUrl,
  fileName = 'model.glb',
  meshNames = null,
  partLabel,
  initialTrackingMode,
  qaContext,
  onViewRecords,
  onBack,
  onChromeBusy,
}: ARExperienceProps) {
  // ── Camera-first model load (runs in the background over the live camera) ──
  const model = useRemoteModel(fileUrl, modelId, fileName, meshNames ?? null);
  const dimensions = model.dimensions;

  const {
    state,
    setUri,
    place,
    setPosition,
    nudgePosition,
    setScale,
    applyAutoFit,
    setRotation,
    toggleLock,
    setPlaced,
    setWireframeUri,
    setRenderMode,
    handlePinch,
    baseScaleRef,
  } = useModelState();

  const baseRotationRef = useRef<Vec3>([0, 0, 0]);
  const [modelStatus, setModelStatus] = useState<string>('loading');
  const [precisionMode, setPrecisionMode] = useState(false);
  const [edgesPanelOpen, setEdgesPanelOpen] = useState(false);
  const [measurePanelOpen, setMeasurePanelOpen] = useState(false);
  // Edge-view styling (the Edges panel): colour is a live material swap, weight
  // (a continuous line-thickness multiplier) re-bakes the tube radius via an
  // on-demand wireframe build.
  const [edgeColor, setEdgeColor] = useState<string>(DEFAULT_EDGE_COLOR);
  // Edges default to a thin crisp line (matches the LiDAR experience); finer
  // (down to 0.10×) via the Edges panel.
  const [edgeWeight, setEdgeWeight] = useState<number>(DEFAULT_EDGE_WEIGHT);
  // Bumped by the "Place point" button to drop a real-world point at the reticle.
  const [placeNonce, setPlaceNonce] = useState(0);
  const [trackingStatus, setTrackingStatus] = useState<string>('normal');
  const [measurements, setMeasurements] = useState<MeasurementState>(DEFAULT_MEASUREMENTS);
  const [trackingMode, setTrackingMode] = useState<TrackingMode>(initialTrackingMode);
  // True while the inspector explicitly asked for wireframe before it was built.
  const [pendingWireframe, setPendingWireframe] = useState(false);

  const navigatorRef = useRef<any>(null);
  const caps = useDeviceCapabilities();
  const [capWarningDismissed, setCapWarningDismissed] = useState(false);
  const [driftSuspected, setDriftSuspected] = useState(false);
  // ── "Lock to surface" (opt-in plane anchoring) ──
  // anchorMode = the user asked to lock onto a real surface; anchored = a
  // ViroARPlane has attached to a detected plane, so the model now rides an
  // ARKit anchor (drift-free) instead of a free world coordinate.
  const [anchorMode, setAnchorMode] = useState(false);
  const [anchored, setAnchored] = useState(false);

  // ── QA capture ──
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
  const [qaPanelOpen, setQaPanelOpen] = useState(false);
  const [logFormOpen, setLogFormOpen] = useState(false);
  const [savingInspection, setSavingInspection] = useState(false);
  const [syncingQueue, setSyncingQueue] = useState(false);

  const [qaOverlay, setQaOverlay] = useState<'off' | 'heatmap' | 'parts'>('off');
  const [focusMeshName, setFocusMeshName] = useState<string | null>(null);

  // The model is "on screen" once it's been auto-placed AND Viro has finished
  // loading it — a large GLB can take a beat to parse after placement, so the
  // pill stays up until first paint and there's never a camera-only gap. An
  // 'error:' status also clears it (the scene reveals what it can; a hard
  // download failure is handled separately by the error card).
  const modelLoadFinished =
    modelStatus.startsWith('loaded') || modelStatus.startsWith('error');
  // Anchored ("Lock to surface") counts as visible too — otherwise the loading
  // pill would never clear while waiting on the plane lock.
  const modelVisible = (state.placed || anchored) && modelLoadFinished;

  const confidenceTag = useCallback((): string => {
    const flags: string[] = [];
    if (!caps.hasDepthSensor) flags.push('no-LiDAR');
    if (trackingStatus !== 'normal') flags.push(`tracking-${trackingStatus}`);
    return flags.length ? ` [low-confidence: ${flags.join(', ')}]` : '';
  }, [caps.hasDepthSensor, trackingStatus]);

  const partNames = dimensions ? dimensions.parts.map((p) => p.name) : [];
  // Model-ruler points are WORLD-space taps on the autofit-scaled model, so the
  // world distance must be divided by the model scale to get the true length
  // (matching the panel readout + 3D label). This pre-fills the Log-QA form.
  const lastRulerMeters =
    measurements.modelRulerPoints.length === 2
      ? Math.hypot(
          measurements.modelRulerPoints[1][0] - measurements.modelRulerPoints[0][0],
          measurements.modelRulerPoints[1][1] - measurements.modelRulerPoints[0][1],
          measurements.modelRulerPoints[1][2] - measurements.modelRulerPoints[0][2],
        ) / (state.scale[0] || 1)
      : null;

  // ── Feed the loaded model into the scene state (camera was already live) ──
  useEffect(() => {
    if (model.phase === 'ready' && model.uri) {
      setUri(model.uri, fileName);
    }
  }, [model.phase, model.uri, fileName, setUri]);

  // Wireframe arrives on demand → register it; switch into it if it was awaited.
  useEffect(() => {
    if (!model.wireframeUri) return;
    setWireframeUri(model.wireframeUri);
    if (pendingWireframe) {
      setRenderMode('wireframe');
      setPendingWireframe(false);
    }
  }, [model.wireframeUri, pendingWireframe, setWireframeUri, setRenderMode]);

  // Reset measurements when the model changes.
  useEffect(() => {
    setMeasurements(DEFAULT_MEASUREMENTS);
  }, [model.uri]);

  // Tracking-loss drift suspicion (only meaningful once placed).
  useEffect(() => {
    if (!state.placed) return;
    if (trackingStatus === 'limited' || trackingStatus === 'unavailable') {
      setDriftSuspected(true);
    }
  }, [trackingStatus, state.placed]);

  useEffect(() => {
    if (trackingMode !== 'world' && trackingStatus === 'normal') {
      setDriftSuspected(false);
    }
  }, [trackingMode, trackingStatus]);

  useEffect(() => {
    setDriftSuspected(false);
  }, [model.uri]);

  // A new model starts un-anchored (free auto-place); drop any prior lock.
  useEffect(() => {
    setAnchorMode(false);
    setAnchored(false);
  }, [model.uri]);

  const updateMeasurements = useCallback((patch: Partial<MeasurementState>) => {
    setMeasurements((m) => ({ ...m, ...patch }));
  }, []);

  const addModelRulerPoint = useCallback((p: Vec3) => {
    setMeasurements((m) => {
      const next = m.modelRulerPoints.length >= 2 ? [p] : [...m.modelRulerPoints, p];
      return { ...m, modelRulerPoints: next };
    });
  }, []);

  const addRealRulerPoint = useCallback((p: Vec3) => {
    setMeasurements((m) => {
      const next = m.realRulerPoints.length >= 2 ? [p] : [...m.realRulerPoints, p];
      return { ...m, realRulerPoints: next };
    });
  }, []);

  const clearRulers = useCallback(() => {
    setMeasurements((m) => ({
      ...m,
      modelRulerPoints: [],
      realRulerPoints: [],
      deviationModelPoint: null,
      deviationRealPoint: null,
    }));
  }, []);

  const addDeviationModelPoint = useCallback((p: Vec3) => {
    setMeasurements((m) => ({ ...m, deviationModelPoint: p, deviationRealPoint: null }));
  }, []);

  const addDeviationRealPoint = useCallback((p: Vec3) => {
    setMeasurements((m) => ({ ...m, deviationRealPoint: p }));
  }, []);

  // Atomic auto-place / tap-place from the scene.
  const handlePlace = useCallback((pos: Vec3) => place(pos), [place]);

  // One-shot auto-fit scale reported by the scene from the model's bbox.
  const handleAutoFit = useCallback((s: Vec3) => applyAutoFit(s), [applyAutoFit]);

  const handleTrackingUpdated = useCallback((status: string) => {
    setTrackingStatus(status);
  }, []);

  const handleRotate = useCallback(
    (rotateState: number, rotationFactor: number) => {
      if (state.locked) return;
      if (rotateState === 2) {
        setRotation([
          baseRotationRef.current[0],
          baseRotationRef.current[1] + rotationFactor,
          baseRotationRef.current[2],
        ]);
      } else if (rotateState === 3) {
        baseRotationRef.current = state.rotation;
      }
    },
    [state.locked, state.rotation, setRotation],
  );

  const handleModelStatus = useCallback((status: string) => {
    setModelStatus(status);
  }, []);

  // ── Align-panel manipulation handlers ──
  // Refs mirror the live transform so press-and-hold ticks accumulate without a
  // stale closure, and so the 2-finger rotate / pinch gestures' bases stay in
  // sync (otherwise a gesture right after a button nudge would jump).
  const rotationRef = useRef<Vec3>(state.rotation);
  const scaleRef = useRef<Vec3>(state.scale);
  useEffect(() => {
    rotationRef.current = state.rotation;
  }, [state.rotation]);
  useEffect(() => {
    scaleRef.current = state.scale;
  }, [state.scale]);

  const handleNudgeRotation = useCallback(
    (delta: Vec3) => {
      if (state.locked) return;
      const next: Vec3 = [
        rotationRef.current[0] + delta[0],
        rotationRef.current[1] + delta[1],
        rotationRef.current[2] + delta[2],
      ];
      rotationRef.current = next;
      baseRotationRef.current = next;
      setRotation(next);
    },
    [state.locked, setRotation],
  );

  const handleQuickRotate = useCallback(
    (deg: number) => handleNudgeRotation([0, deg, 0]),
    [handleNudgeRotation],
  );

  const handleScaleBy = useCallback(
    (factor: number) => {
      if (state.locked) return;
      const f = Math.max(0.01, Math.min(5, scaleRef.current[0] * factor));
      const next: Vec3 = [f, f, f];
      scaleRef.current = next;
      baseScaleRef.current = next;
      setScale(next);
    },
    [state.locked, setScale, baseScaleRef],
  );

  // ── Per-part inspection ──
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

  const handlePartTap = useCallback(
    (meshName: string) => {
      Alert.alert(meshName, 'Inspection result for this part?', [
        { text: 'Pass', onPress: () => void logPart(meshName, 'pass') },
        { text: 'Warning', onPress: () => void logPart(meshName, 'warning') },
        { text: 'Fail', style: 'destructive', onPress: () => void logPart(meshName, 'fail') },
        {
          text: focusMeshName === meshName ? 'Unfocus' : 'Focus',
          onPress: () => setFocusMeshName((f) => (f === meshName ? null : meshName)),
        },
        { text: 'Cancel', style: 'cancel' },
      ]);
    },
    [logPart, focusMeshName],
  );

  // ── Deviation probe → QA measurement ──
  const handleLogDeviation = useCallback(async () => {
    const a = measurements.deviationModelPoint;
    const b = measurements.deviationRealPoint;
    if (!a || !b) return;
    const mm = Math.round(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 1000 * 10) / 10;
    try {
      await createQuality({
        modelId,
        meshName: focusMeshName ?? 'deviation-probe',
        status: 'warning',
        inspector: inspectorName,
        measurementValue: mm,
        measurementUnit: 'mm',
        notes: `AR deviation probe${confidenceTag()}`,
        ...qaContext,
      });
      setMeasurements((m) => ({ ...m, deviationModelPoint: null, deviationRealPoint: null }));
      notifySuccess();
      Alert.alert('Logged', `Deviation of ${mm} mm recorded.`);
    } catch (e) {
      notifyError();
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Failed to save deviation');
    }
  }, [
    measurements.deviationModelPoint,
    measurements.deviationRealPoint,
    createQuality,
    modelId,
    focusMeshName,
    inspectorName,
    confidenceTag,
    qaContext,
  ]);

  // ── Evidence capture ──
  const handleCaptureEvidence = useCallback(
    async (entry: ARQualityEntry) => {
      const snap = await captureSnapshot(navigatorRef);
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

  // ── Sign-off ──
  const handleSignoff = useCallback(
    (entry: ARQualityEntry) => {
      if (!can('quality-analysis.signoff')) {
        Alert.alert(
          'Sign-off',
          'Your role cannot approve/reject inspections — a reviewer with sign-off permission will pick this up.',
        );
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

  // ── Log-inspection submit ──
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
      Alert.alert(
        'Still offline',
        `${pendingCount} inspection${pendingCount === 1 ? '' : 's'} saved on this device. They'll upload automatically the moment you're back online — nothing is lost.`,
      );
      return;
    }
    setSyncingQueue(true);
    try {
      const { synced, failed } = await flushQueue();
      if (failed > 0) {
        Alert.alert(
          'Some items could not sync',
          `${synced} uploaded, ${failed} could not be saved.\n\nThose were rejected by the server (e.g. failed validation) or an image gave up after repeated retries, so they were removed from the queue. Re-log them if needed.`,
        );
      } else if (synced > 0) {
        Alert.alert('Synced', `${synced} queued inspection${synced === 1 ? '' : 's'} uploaded.`);
      }
    } catch {
      Alert.alert(
        "Couldn't sync",
        "We couldn't reach the server. Your inspections stay queued and will retry automatically.",
      );
    } finally {
      setSyncingQueue(false);
    }
  }, [syncingQueue, pendingCount, flushQueue]);

  // ── Persisted registration: restore scale/rotation/render mode for this model
  // AFTER the model URI is set (setUri resets transform). Restoring marks the
  // scale as fitted so the scene won't override the saved size. ──
  const restoredForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!state.uri) return;
    if (restoredForRef.current === modelId) return;
    restoredForRef.current = modelId;
    (async () => {
      const reg = await loadRegistration(modelId);
      if (!reg) return; // no saved setup → scene auto-fits on load
      applyAutoFit(reg.scale); // sets scale + marks autoFitted (skips auto-fit)
      baseRotationRef.current = reg.rotation;
      setRotation(reg.rotation);
      // Wireframe isn't auto-restored (needs on-demand generation); anything else
      // (incl. legacy 'ghost') resolves to the only other view, solid.
      if (reg.renderMode !== 'wireframe') setRenderMode('solid');
    })();
  }, [state.uri, modelId, applyAutoFit, setRotation, setRenderMode]);

  useEffect(() => {
    restoredForRef.current = null;
  }, [modelId]);

  // Save registration whenever the placed model's transform / render mode change.
  useEffect(() => {
    if (!state.placed) return;
    void saveRegistration(modelId, {
      scale: state.scale,
      rotation: state.rotation,
      renderMode: state.renderMode,
    });
  }, [state.placed, state.scale, state.rotation, state.renderMode, modelId]);

  // ── Re-center: drop the placement so the scene re-auto-places in front of the
  // camera. Scale / rotation / render mode are preserved. ──
  const handleRecenter = useCallback(() => {
    if (state.locked) return;
    setPlaced(false);
    setDriftSuspected(false);
  }, [state.locked, setPlaced]);

  // ── "Lock to surface" toggle (opt-in plane anchoring) ──
  // Entering: drop the free placement and zero the transform so `position`
  // becomes a LOCAL offset from the plane centre (the model snaps onto the
  // detected surface, then is nudged to align). Leaving: free auto-place resumes.
  // Scale / rotation are preserved across the switch.
  const handleAnchorFound = useCallback(() => setAnchored(true), []);
  const toggleAnchorMode = useCallback(() => {
    if (state.locked) return;
    setAnchorMode((on) => {
      const next = !on;
      setAnchored(false);
      setPlaced(false);
      if (next) {
        setPosition([0, 0, 0]);
        setDriftSuspected(false);
        setMeasurements(DEFAULT_MEASUREMENTS);
      }
      return next;
    });
  }, [state.locked, setPlaced, setPosition]);

  // ── Live tracking-mode switch. Drop placement (the scene re-auto-places under
  // the new preset) + reset measurements; keep scale/rotation/render mode. ──
  const handleSelectMode = useCallback(
    (mode: TrackingMode) => {
      if (mode === trackingMode) return;
      setTrackingMode(mode);
      setPlaced(false);
      setDriftSuspected(false);
      setMeasurements(DEFAULT_MEASUREMENTS);
    },
    [trackingMode, setPlaced],
  );

  // ── Bottom panels are mutually exclusive (Align / Edges / Measure) — opening
  // one closes the others so they never stack on top of each other. ──
  const togglePrecision = useCallback(() => {
    setPrecisionMode((p) => !p);
    setEdgesPanelOpen(false);
    setMeasurePanelOpen(false);
  }, []);
  const toggleEdgesPanel = useCallback(() => {
    const opening = !edgesPanelOpen;
    setEdgesPanelOpen(opening);
    setPrecisionMode(false);
    setMeasurePanelOpen(false);
    // Opening the Edges tab turns the edge view ON by default.
    if (opening && state.renderMode !== 'wireframe') {
      if (model.wireframeUri) setRenderMode('wireframe');
      else setPendingWireframe(true);
      model.requestWireframe(edgeWeight, edgeColor);
    }
  }, [edgesPanelOpen, state.renderMode, model, edgeWeight, edgeColor, setRenderMode]);
  const toggleMeasurePanel = useCallback(() => {
    setMeasurePanelOpen((m) => !m);
    setPrecisionMode(false);
    setEdgesPanelOpen(false);
  }, []);

  // ── Edge view: VIEW switch (Solid / Edges), colour, line weight ──
  // Selecting Edges needs a wireframe GLB at the current weight; it generates on
  // demand (requestWireframe dedups internally) and pendingWireframe flips the
  // mode in once the first build lands.
  const handleSelectView = useCallback(
    (mode: RenderMode) => {
      if (mode !== 'wireframe') {
        setRenderMode(mode);
        return;
      }
      if (model.wireframeUri) {
        setRenderMode('wireframe'); // show what's already built
      } else {
        setPendingWireframe(true); // switch in once the first build lands
        if (!model.wireframeBusy) notifySuccess('Generating edges…');
      }
      model.requestWireframe(edgeWeight, edgeColor); // ensure the current weight+colour
    },
    [model, setRenderMode, edgeWeight, edgeColor],
  );

  // Swatch tap: rebuild the edge view in the new colour (each colour is a
  // distinct GLB — Viro won't recolour a loaded GLB via a prop change).
  const handleSelectColor = useCallback(
    (hex: string) => {
      setEdgeColor(hex);
      if (state.renderMode === 'wireframe') {
        setPendingWireframe(true);
        model.requestWireframe(edgeWeight, hex);
      }
    },
    [state.renderMode, model, edgeWeight],
  );

  // Preset tap / slider release: commit the weight and rebuild the edge view.
  // (The slider tracks its own drag locally and only reports on release, so the
  // panel doesn't re-render mid-drag.)
  const handleCommitWeight = useCallback(
    (weight: number) => {
      setEdgeWeight(weight);
      if (state.renderMode === 'wireframe') {
        setPendingWireframe(true);
        model.requestWireframe(weight, edgeColor);
      }
    },
    [state.renderMode, model, edgeColor],
  );

  // Edges ON by default: once the model is ready, switch into the (thinnest) edge
  // view automatically — once per model (matches the LiDAR experience).
  const autoEdgesRef = useRef<string | null>(null);
  useEffect(() => {
    if (model.phase === 'ready' && model.uri && autoEdgesRef.current !== model.uri) {
      autoEdgesRef.current = model.uri;
      handleSelectView('wireframe');
    }
  }, [model.phase, model.uri, handleSelectView]);

  // Tell the host when a docked panel is open so it can hide the engine switcher.
  useEffect(() => {
    onChromeBusy?.(precisionMode || edgesPanelOpen || measurePanelOpen);
  }, [precisionMode, edgesPanelOpen, measurePanelOpen, onChromeBusy]);


  if (!ViroARSceneNavigator) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>AR is not available on this build.</Text>
      </View>
    );
  }

  // In anchor mode the model is already downloaded (Lock is only reachable after
  // placement), and the "point at a surface" banner stands in for the pill — so
  // suppress the placing pill there to avoid a stuck "Placing model…".
  const loadingActive = model.phase !== 'error' && !modelVisible && !anchorMode;
  const loadingText =
    model.phase === 'ready'
      ? 'Placing model…'
      : model.progress ?? 'Loading…';

  return (
    <View style={styles.container}>
      {/* ── Live AR camera. Mounted ONCE, immediately — never re-keyed. ── */}
      <ViroARSceneNavigator
        ref={navigatorRef}
        // 'Camera' alignment locks the world frame to the device's pose at
        // session start, so a STATIONARY model visibly swims as you move — never
        // use it for placed content. 'Gravity' keeps the world level-locked (the
        // steady default); image mode adds compass heading on top.
        worldAlignment={trackingMode === 'image' ? 'GravityAndHeading' : 'Gravity'}
        autofocus={true}
        videoQuality="High"
        // NOTE: Viro 2.43.3 exposes NO real-world occlusion. `depthEnabled` and
        // `occlusionMode` are NOT props on this navigator — verified against the
        // package AND the native binary: ARKit's personSegmentation/sceneDepth
        // and ARCore's Depth API are never requested by Viro's renderer, which
        // composites no depth/segmentation matte. They were silently inert and
        // have been removed. A rendered model always draws over the camera feed,
        // so a hand between the camera and the model cannot be occluded here.
        // The renderer flags below ARE real Viro props.
        hdrEnabled={true}
        pbrEnabled={true}
        shadowsEnabled={true}
        initialScene={{ scene: ARModelScene as any }}
        viroAppProps={{
          modelUri: state.uri ?? '',
          wireframeUri: state.wireframeUri,
          renderMode: state.renderMode,
          edgeColor,
          trackingMode,
          placed: state.placed,
          autoFitted: state.autoFitted,
          autoPlace: true,
          anchorMode,
          onAnchorFound: handleAnchorFound,
          position: state.position,
          scale: state.scale,
          rotation: state.rotation,
          locked: state.locked,
          dimensions,
          measurements,
          qualityEntries,
          onPlace: handlePlace,
          onAutoFit: handleAutoFit,
          onPinch: handlePinch,
          onRotate: handleRotate,
          onModelStatus: handleModelStatus,
          onTrackingUpdated: handleTrackingUpdated,
          onAddModelRulerPoint: addModelRulerPoint,
          onAddRealRulerPoint: addRealRulerPoint,
          onAddDeviationModelPoint: addDeviationModelPoint,
          onAddDeviationRealPoint: addDeviationRealPoint,
          qaOverlayVisible: qaOverlay !== 'off',
          qaSelectable: qaOverlay === 'parts',
          focusMeshName,
          onPartTap: handlePartTap,
          placeNonce,
        }}
        style={styles.arView}
      />

      {/* ── Header chrome (hidden during locked inspection) ── */}
      {!state.locked && (
        <>
          <TouchableOpacity style={styles.backButton} onPress={onBack}>
            <Text style={styles.backButtonText}>{'< Back'}</Text>
          </TouchableOpacity>

          <View style={styles.modelNameContainer} pointerEvents="none">
            <Text style={styles.modelNameText} numberOfLines={1}>
              {partLabel || state.fileName || fileName}
            </Text>
            <Text style={styles.modelStatusText} numberOfLines={1}>
              {`model: ${modelStatus}`}
            </Text>
          </View>

          {onViewRecords && (
            <TouchableOpacity style={styles.recordsButton} onPress={onViewRecords}>
              <Text style={styles.recordsButtonText}>Records</Text>
            </TouchableOpacity>
          )}

          <View style={styles.switcherRow} pointerEvents="box-none">
            <TrackingModeSwitcher value={trackingMode} onChange={handleSelectMode} />
          </View>

          {/* Edges quick-toggle — top-right (Standard has no occlusion toggle) */}
          {(state.placed || anchored) && (
            <View style={styles.edgesChipWrap} pointerEvents="box-none">
              <ToggleChip
                icon="◰"
                label="Edges"
                on={state.renderMode === 'wireframe'}
                onPress={() =>
                  handleSelectView(state.renderMode === 'wireframe' ? 'solid' : 'wireframe')
                }
              />
            </View>
          )}
        </>
      )}

      {/* ── Loading pill over the live camera (never a black screen) ── */}
      {loadingActive && (
        <View style={styles.loadingPillWrap} pointerEvents="none">
          <View style={styles.loadingPill}>
            <ActivityIndicator size="small" color="#ffffff" />
            <Text style={styles.loadingPillText}>{loadingText}</Text>
          </View>
        </View>
      )}

      {/* ── Error card over the live camera, with retry ── */}
      {model.phase === 'error' && (
        <View style={styles.errorWrap} pointerEvents="box-none">
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Couldn’t load the model</Text>
            <Text style={styles.errorMsg}>{model.error ?? 'The model file is unavailable.'}</Text>
            <View style={styles.errorActions}>
              <TouchableOpacity style={styles.errorRetry} onPress={model.retry} activeOpacity={0.85}>
                <Text style={styles.errorRetryText}>Retry</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.errorBack} onPress={onBack} activeOpacity={0.85}>
                <Text style={styles.errorBackText}>Go back</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* ── Banner stack: capability notice, tracking state, drift recovery ── */}
      {!state.locked && (
        <View style={styles.bannerStack} pointerEvents="box-none">
          {Platform.OS === 'ios' && caps.checked && !caps.hasDepthSensor && !capWarningDismissed && (
            <View style={[styles.banner, styles.bannerWarn]}>
              <Text style={styles.bannerText}>
                No LiDAR on this device — tracking uses the camera + motion sensors. Keep textured
                surroundings in view and move slowly for the steadiest overlay; real-world
                measurements are approximate.
              </Text>
              <TouchableOpacity
                style={styles.bannerDismiss}
                onPress={() => setCapWarningDismissed(true)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.bannerDismissText}>✕</Text>
              </TouchableOpacity>
            </View>
          )}

          {trackingStatus !== 'normal' && (
            <View style={[styles.banner, styles.bannerWarn]}>
              <Text style={styles.bannerText}>
                {trackingStatus === 'limited'
                  ? 'Tracking limited — move device slowly side-to-side in a well-lit area'
                  : 'Tracking unavailable — check lighting and keep the camera on textured surroundings'}
              </Text>
            </View>
          )}

          {driftSuspected &&
            state.placed &&
            trackingMode === 'world' &&
            trackingStatus === 'normal' && (
              <View style={[styles.banner, styles.bannerInfo]}>
                <Text style={[styles.bannerText, styles.bannerTextOnInfo]}>
                  Tracking was interrupted — the model may have drifted out of alignment.
                </Text>
                <TouchableOpacity style={styles.bannerAction} onPress={handleRecenter}>
                  <Text style={styles.bannerActionText}>Re-center</Text>
                </TouchableOpacity>
              </View>
            )}

          {anchorMode && !anchored && (
            <View style={[styles.banner, styles.bannerInfo]}>
              <Text style={[styles.bannerText, styles.bannerTextOnInfo]}>
                Point the camera at a flat surface (the floor or table the part sits on). The model
                locks onto it and stays rock-steady; then nudge with Align to line it up.
              </Text>
            </View>
          )}
        </View>
      )}

      {/* ── AR-QA visualization rail ── */}
      {(state.placed || anchorMode) && !state.locked && !measurePanelOpen && (
        <View style={styles.vizRail} pointerEvents="box-none">
          <TouchableOpacity
            style={[styles.vizButton, anchorMode && styles.vizButtonActive]}
            onPress={toggleAnchorMode}
            activeOpacity={0.7}
          >
            <Text style={styles.vizButtonText}>
              {anchorMode ? (anchored ? '🔒 Locked' : 'Finding…') : '🔒 Lock surface'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.vizButton, qaOverlay !== 'off' && styles.vizButtonActive]}
            onPress={() =>
              setQaOverlay((m) => (m === 'off' ? 'heatmap' : m === 'heatmap' ? 'parts' : 'off'))
            }
            activeOpacity={0.7}
          >
            <Text style={styles.vizButtonText}>
              {qaOverlay === 'off' ? 'QA Map' : qaOverlay === 'heatmap' ? 'Heatmap' : 'Tap-QA'}
            </Text>
          </TouchableOpacity>

          {focusMeshName && (
            <TouchableOpacity
              style={[styles.vizButton, styles.vizButtonActive]}
              onPress={() => setFocusMeshName(null)}
              activeOpacity={0.7}
            >
              <Text style={styles.vizButtonText}>Unfocus</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.vizButton} onPress={handleRecenter} activeOpacity={0.7}>
            <Text style={styles.vizButtonText}>⟲ Re-center</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Offline-queue sync pill ── */}
      {!state.locked && !precisionMode && !edgesPanelOpen && !measurePanelOpen && pendingCount > 0 && (
        <View style={styles.bottomCenter} pointerEvents="box-none">
          <TouchableOpacity
            style={[styles.queueChip, syncingQueue && styles.queueChipBusy]}
            onPress={handleSyncQueue}
            disabled={syncingQueue}
            activeOpacity={0.8}
            hitSlop={{ top: 10, bottom: 10, left: 16, right: 16 }}
          >
            {syncingQueue ? (
              <ActivityIndicator size="small" color="#0b1220" />
            ) : (
              <Text style={styles.queueChipIcon}>⟳</Text>
            )}
            <Text style={styles.queueChipText}>
              {syncingQueue ? 'Syncing…' : `${pendingCount} queued offline · tap to sync`}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Align-mode controls (consolidated, non-overlapping) ── */}
      {precisionMode && (state.placed || anchored) && (
        <AlignPanel
          scale={state.scale}
          locked={state.locked}
          onNudgePosition={nudgePosition}
          onNudgeRotation={handleNudgeRotation}
          onScaleBy={handleScaleBy}
          onQuickRotate={handleQuickRotate}
          onToggleLock={toggleLock}
          bottomOffset={PANEL_BOTTOM}
          translucent
        />
      )}

      {/* ── Edge-view controls (view / colour / weight) ── */}
      {edgesPanelOpen && state.placed && (
        <EdgesPanel
          renderMode={state.renderMode}
          edgeColor={edgeColor}
          edgeWeight={edgeWeight}
          busy={model.wireframeBusy}
          onSelectView={handleSelectView}
          onSelectColor={handleSelectColor}
          onCommitWeight={handleCommitWeight}
          bottomOffset={PANEL_BOTTOM}
          translucent
        />
      )}

      {/* ── Measurement panel ── */}
      {!state.locked && measurePanelOpen && (
        <MeasurementPanel
          measurements={measurements}
          dimensions={dimensions}
          modelScale={state.scale[0]}
          onChange={updateMeasurements}
          onClearRulers={clearRulers}
          onLogDeviation={handleLogDeviation}
          bottomOffset={PANEL_BOTTOM}
          translucent
        />
      )}

      {/* ── Aim reticle + "Place point" for real-world points (real ruler /
          deviation real point). Aiming + pressing is far more precise than
          tapping a small target; model points are tapped on the model. ── */}
      {!state.locked &&
        measurePanelOpen &&
        state.placed &&
        (measurements.realRulerActive ||
          (measurements.deviationActive &&
            !!measurements.deviationModelPoint &&
            !measurements.deviationRealPoint)) && (
          <View style={styles.reticleWrap} pointerEvents="box-none">
            <View style={styles.reticle} pointerEvents="none">
              <View style={styles.reticleRing} />
              <View style={styles.reticleDot} />
            </View>
            <TouchableOpacity
              style={styles.placeButton}
              onPress={() => setPlaceNonce((n) => n + 1)}
              activeOpacity={0.85}
            >
              <Text style={styles.placeButtonText}>＋ Place point</Text>
            </TouchableOpacity>
          </View>
        )}

      {/* ── Lock / Unlock ── */}
      {state.placed && state.locked && !precisionMode && (
        <TouchableOpacity style={styles.lockButton} onPress={toggleLock} activeOpacity={0.7}>
          <Text style={styles.lockButtonText}>{state.locked ? 'Unlock' : 'Lock'}</Text>
        </TouchableOpacity>
      )}

      {/* ── Toolbar — vertical rail on the RIGHT (model keeps the bottom + middle) ── */}
      {!state.locked && (
        <ToolBar
          placed={state.placed}
          anchored={anchored}
          modelLoaded={!!state.uri}
          precisionMode={precisionMode}
          edgesPanelOpen={edgesPanelOpen}
          measurePanelOpen={measurePanelOpen}
          onTogglePrecision={togglePrecision}
          onToggleEdges={toggleEdgesPanel}
          onToggleMeasure={toggleMeasurePanel}
          side="right"
        />
      )}

      {/* ── QA panel toggle ── */}
      {(state.placed || anchored) && (
        <TouchableOpacity
          style={styles.qaButton}
          onPress={() => setQaPanelOpen((o) => !o)}
          activeOpacity={0.7}
        >
          <Text style={styles.qaButtonText}>{qaPanelOpen ? 'Close QA' : 'QA'}</Text>
        </TouchableOpacity>
      )}

      {/* ── QA inspection panel ── */}
      {(state.placed || anchored) && qaPanelOpen && (
        <QualityPanel
          entries={qualityEntries}
          loading={qualityLoading}
          onClose={() => setQaPanelOpen(false)}
          onLogNew={() => setLogFormOpen(true)}
          onSignoff={handleSignoff}
          onCaptureEvidence={handleCaptureEvidence}
        />
      )}

      {/* ── Log-inspection modal ── */}
      <LogInspectionForm
        visible={logFormOpen}
        partNames={partNames}
        defaultMeasurement={lastRulerMeters}
        submitting={savingInspection}
        onSubmit={handleLogInspection}
        onCancel={() => setLogFormOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  arView: { flex: 1 },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
    padding: 24,
  },
  loadingText: { color: '#ffffff', fontSize: 16, textAlign: 'center' },
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
  backButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  // Assembly name + status, left-aligned just under the Back button.
  modelNameContainer: {
    position: 'absolute',
    top: 90,
    left: 16,
    right: 160,
    zIndex: 10,
  },
  modelNameText: { color: '#ffffff', fontSize: 15, fontWeight: '800', maxWidth: '100%' },
  modelStatusText: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '600', marginTop: 1 },
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
  recordsButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  switcherRow: {
    position: 'absolute',
    top: 92,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 24,
  },
  // Loading pill — small, over the live camera, top-center under the switcher.
  loadingPillWrap: {
    position: 'absolute',
    top: 150,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 16,
  },
  loadingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(13, 17, 23, 0.85)',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 22,
  },
  loadingPillText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  // Error card — centered over the live camera.
  errorWrap: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    zIndex: 40,
  },
  errorCard: {
    backgroundColor: 'rgba(13, 17, 23, 0.95)',
    borderRadius: 18,
    padding: 22,
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
  },
  errorTitle: { color: '#ffffff', fontSize: 18, fontWeight: '800', marginBottom: 8 },
  errorMsg: { color: '#cbd5e1', fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 18 },
  errorActions: { flexDirection: 'row', gap: 12 },
  errorRetry: {
    backgroundColor: '#1565c0',
    paddingVertical: 12,
    paddingHorizontal: 26,
    borderRadius: 12,
  },
  errorRetryText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  errorBack: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 12,
  },
  errorBackText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  bannerStack: {
    position: 'absolute',
    top: 200,
    left: 16,
    right: 16,
    zIndex: 15,
    gap: 8,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  bannerWarn: { backgroundColor: 'rgba(234, 179, 8, 0.92)' },
  bannerInfo: { backgroundColor: 'rgba(59, 130, 246, 0.95)' },
  bannerText: { flex: 1, color: '#1f2937', fontSize: 15, fontWeight: '700' },
  bannerTextOnInfo: { color: '#ffffff' },
  bannerDismiss: { marginLeft: 10, paddingHorizontal: 4 },
  bannerDismissText: { color: '#1f2937', fontSize: 15, fontWeight: '800' },
  bannerAction: {
    marginLeft: 12,
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 18,
  },
  bannerActionText: { color: '#1d4ed8', fontSize: 14, fontWeight: '800' },
  lockButton: {
    position: 'absolute',
    top: 150,
    right: 16,
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.92)',
    paddingVertical: 11,
    paddingHorizontal: 20,
    borderRadius: 22,
    zIndex: 25,
  },
  lockButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
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
  qaButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  // Aim reticle (screen centre) + Place button for real-world point capture.
  reticleWrap: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 30,
  },
  reticle: { alignItems: 'center', justifyContent: 'center' },
  reticleRing: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  reticleDot: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#0ea5e9',
  },
  placeButton: {
    marginTop: 76,
    backgroundColor: 'rgba(14, 165, 233, 0.97)',
    paddingVertical: 13,
    paddingHorizontal: 30,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: '#ffffff',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  placeButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  // Left edge, below the QA button — keeps the RIGHT edge clear for the toolbar rail.
  vizRail: { position: 'absolute', left: 12, top: 206, gap: 8, zIndex: 18 },
  // Edges quick-toggle, top-right under the Records button.
  edgesChipWrap: { position: 'absolute', top: 92, right: 16, alignItems: 'flex-end', zIndex: 24 },
  vizButton: {
    backgroundColor: 'rgba(13, 17, 23, 0.85)',
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 20,
    minWidth: 108,
    alignItems: 'center',
  },
  vizButtonActive: { backgroundColor: 'rgba(14, 165, 233, 0.92)' },
  vizButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  bottomCenter: {
    position: 'absolute',
    bottom: 92,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 6,
    zIndex: 15,
  },
  queueChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    backgroundColor: 'rgba(245, 158, 11, 0.97)',
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 22,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  queueChipBusy: { backgroundColor: 'rgba(245, 158, 11, 0.75)' },
  queueChipIcon: { color: '#0b1220', fontSize: 18, fontWeight: '900' },
  queueChipText: { color: '#0b1220', fontSize: 15, fontWeight: '800' },
});
