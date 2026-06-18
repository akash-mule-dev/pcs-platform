// Ported from glb-viewer's ARScreen, adapted for PCS:
//   - Viro navigator is lazy-`require`d (Expo Go safe)
//   - the model + wireframe + dimensions arrive as props (downloaded by the
//     host screen from the PCS backend) instead of being read from a local
//     document-picker file.
// All interaction logic (placement, lock, render-mode cycle, measurement
// rulers, align d-pad / scale / tilt / joystick) is unchanged from glb-viewer.
import React, { useRef, useCallback, useState, useEffect } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Alert, Platform, ActivityIndicator } from 'react-native';
import { offlineService } from '../../../services/offline.service';
import { notifySuccess, notifyError } from '../../../utils/feedback';
import ARModelScene from './ARModelScene';
import ToolBar from './ToolBar';
import TrackingModeSwitcher from './TrackingModeSwitcher';
import MeasurementPanel from './MeasurementPanel';
import Joystick from './Joystick';
import ScaleControls from './ScaleControls';
import TiltControls from './TiltControls';
import QualityPanel from './QualityPanel';
import LogInspectionForm, { InspectionFormResult } from './LogInspectionForm';
import { useModelState } from './useModelState';
import { useDeviceCapabilities } from './useDeviceCapabilities';
import { useQualityData, ARQualityEntry } from './useQualityData';
import { useAuth } from '../../../context/AuthContext';
import { can } from '../../../config/permissions';
import {
  Vec3,
  TrackingMode,
  MeasurementState,
  DEFAULT_MEASUREMENTS,
} from './types';
import { ModelDimensions } from './dimensionExtractor';
import { captureSnapshot } from './arSnapshot';
import { loadRegistration, saveRegistration } from './arRegistration';

// Lazy-load the Viro navigator — static import crashes in Expo Go.
let ViroARSceneNavigator: any = null;
try {
  ViroARSceneNavigator = require('@reactvision/react-viro').ViroARSceneNavigator;
} catch {
  // handled by the host screen
}

interface ARExperienceProps {
  modelId: string;
  modelUri: string;
  fileName: string;
  wireframeUri: string | null;
  dimensions: ModelDimensions | null;
  /** Mode the session opens in; the inspector can switch it live in-AR. */
  initialTrackingMode: TrackingMode;
  /** Open the (non-AR) Quality records viewer for this model. */
  onViewRecords?: () => void;
  onBack: () => void;
}

export default function ARExperience({
  modelId,
  modelUri,
  fileName,
  wireframeUri,
  dimensions,
  initialTrackingMode,
  onViewRecords,
  onBack,
}: ARExperienceProps) {
  const {
    state,
    setUri,
    setPosition,
    nudgePosition,
    setScale,
    setRotation,
    toggleLock,
    setPlaced,
    setWireframeUri,
    cycleRenderMode,
    setRenderMode,
    toggleEdgesMode,
    reset,
    handlePinch,
    baseScaleRef,
  } = useModelState();

  const baseRotationRef = useRef<Vec3>([0, 0, 0]);
  const positionRef = useRef<Vec3>([0, 0, 0]);
  const [modelStatus, setModelStatus] = useState<string>('loading');
  const [precisionMode, setPrecisionMode] = useState(false);
  const [measurePanelOpen, setMeasurePanelOpen] = useState(false);
  const [trackingStatus, setTrackingStatus] = useState<string>('normal');
  const [measurements, setMeasurements] = useState<MeasurementState>(DEFAULT_MEASUREMENTS);
  // Tracking mode is live-switchable from the in-AR segmented control so the
  // inspector can compare World / Plane / Image anchoring without leaving AR.
  const [trackingMode, setTrackingMode] = useState<TrackingMode>(initialTrackingMode);

  // Ref to the Viro navigator so we can imperatively reset the AR session
  // (clear anchors + tracking) during recovery.
  const navigatorRef = useRef<any>(null);
  // Depth-sensing capability of the running device (LiDAR vs none).
  const caps = useDeviceCapabilities();
  const [capWarningDismissed, setCapWarningDismissed] = useState(false);
  // True once tracking has degraded after the model was placed: the overlay
  // may no longer be aligned with the real object.
  const [driftSuspected, setDriftSuspected] = useState(false);

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
  // True while the offline QA queue is being drained from the sync pill.
  const [syncingQueue, setSyncingQueue] = useState(false);

  // ── AR visualization / inspection modes ──
  // QA overlay: 'off' | 'heatmap' (status-colored part volumes) | 'parts'
  // (the same volumes, but tappable to log a per-part result).
  const [qaOverlay, setQaOverlay] = useState<'off' | 'heatmap' | 'parts'>('off');
  const [focusMeshName, setFocusMeshName] = useState<string | null>(null);
  // Depth occlusion — only meaningful on LiDAR devices in solid mode.
  const [occlusionOn, setOcclusionOn] = useState(false);

  // Capture confidence: LiDAR + normal tracking = high; no LiDAR = medium;
  // degraded tracking = low. Used to gate/annotate measurements.
  const confidence: 'high' | 'medium' | 'low' | null = !state.placed
    ? null
    : trackingStatus !== 'normal'
      ? 'low'
      : caps.hasDepthSensor
        ? 'high'
        : 'medium';

  // A note suffix that records why a measurement may be unreliable, so
  // visual-estimate data is distinguishable from LiDAR-grade data in the record.
  const confidenceTag = useCallback((): string => {
    const flags: string[] = [];
    if (!caps.hasDepthSensor) flags.push('no-LiDAR');
    if (trackingStatus !== 'normal') flags.push(`tracking-${trackingStatus}`);
    return flags.length ? ` [low-confidence: ${flags.join(', ')}]` : '';
  }, [caps.hasDepthSensor, trackingStatus]);
  const partNames = dimensions ? dimensions.parts.map((p) => p.name) : [];
  const lastRulerMeters =
    measurements.modelRulerPoints.length === 2
      ? Math.hypot(
          measurements.modelRulerPoints[1][0] - measurements.modelRulerPoints[0][0],
          measurements.modelRulerPoints[1][1] - measurements.modelRulerPoints[0][1],
          measurements.modelRulerPoints[1][2] - measurements.modelRulerPoints[0][2],
        )
      : null;

  const handleLogInspection = useCallback(
    async (result: InspectionFormResult) => {
      setSavingInspection(true);
      try {
        await createQuality({ modelId, inspector: inspectorName, ...result });
        setLogFormOpen(false);
        notifySuccess(offlineService.isOnline ? 'Inspection logged' : 'Saved offline — will sync');
      } catch (e) {
        notifyError();
        Alert.alert('Could not save', e instanceof Error ? e.message : 'Failed to save inspection');
      } finally {
        setSavingInspection(false);
      }
    },
    [createQuality, modelId, inspectorName],
  );

  // Drain the offline QA queue on demand (the inspector taps the sync pill).
  // Offline → reassure (it auto-syncs later); online → flush and report the
  // synced/failed split so a rejected record or a given-up image is never silent.
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

  // Set initial model on mount / when the prepared model changes.
  useEffect(() => {
    setUri(modelUri, fileName);
    if (wireframeUri) {
      setWireframeUri(wireframeUri);
    }
  }, [modelUri, fileName, wireframeUri, setUri, setWireframeUri]);

  // Reset measurements when the model changes.
  useEffect(() => {
    setMeasurements(DEFAULT_MEASUREMENTS);
  }, [modelUri]);

  // Mirror state.position into a ref so callbacks can read the latest value.
  useEffect(() => {
    positionRef.current = state.position;
  }, [state.position]);

  // Tracking-loss recovery. Once the model is placed, any drop to LIMITED or
  // UNAVAILABLE means the overlay may have shifted relative to the real object.
  useEffect(() => {
    if (!state.placed) return;
    if (trackingStatus === 'limited' || trackingStatus === 'unavailable') {
      setDriftSuspected(true);
    }
  }, [trackingStatus, state.placed]);

  // Plane- and image-anchored content re-localizes itself once ARKit regains
  // normal tracking, so clear the drift flag automatically for those modes.
  // World mode has no anchor — its drift is permanent until the user re-places,
  // so the flag is kept until they act on it.
  useEffect(() => {
    if (trackingMode !== 'world' && trackingStatus === 'normal') {
      setDriftSuspected(false);
    }
  }, [trackingMode, trackingStatus]);

  // A new model clears any pending drift state.
  useEffect(() => {
    setDriftSuspected(false);
  }, [modelUri]);

  const updateMeasurements = useCallback(
    (patch: Partial<MeasurementState>) => {
      setMeasurements((m) => ({ ...m, ...patch }));
    },
    []
  );

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

  const handlePlace = useCallback(
    (pos: Vec3) => {
      setPosition(pos);
      setPlaced(true);
    },
    [setPosition, setPlaced]
  );

  const handleTrackingUpdated = useCallback((status: string) => {
    setTrackingStatus(status);
  }, []);

  const handleRotate = useCallback(
    (rotateState: number, rotationFactor: number) => {
      if (state.locked) return;
      if (rotateState === 2) {
        const newRotation: Vec3 = [
          baseRotationRef.current[0],
          baseRotationRef.current[1] + rotationFactor,
          baseRotationRef.current[2],
        ];
        setRotation(newRotation);
      } else if (rotateState === 3) {
        baseRotationRef.current = state.rotation;
      }
    },
    [state.locked, state.rotation, setRotation]
  );

  const handleModelStatus = useCallback((status: string) => {
    setModelStatus(status);
  }, []);

  const handleScaleChange = useCallback(
    (s: Vec3) => {
      if (state.locked) return;
      baseScaleRef.current = s;
      setScale(s);
    },
    [state.locked, setScale, baseScaleRef]
  );

  // The joystick reports its deflection only while the finger is moving and
  // once with {0,0} on release. A joystick must drive the model continuously
  // for as long as it's held deflected, so we stash the latest vector and run
  // an interval loop that nudges the position each tick until release.
  const joystickVecRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const joystickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopJoystickDrive = useCallback(() => {
    if (joystickTimerRef.current !== null) {
      clearInterval(joystickTimerRef.current);
      joystickTimerRef.current = null;
    }
  }, []);

  const handleJoystickChange = useCallback(
    (v: { x: number; y: number }) => {
      joystickVecRef.current = v;
      if (v.x === 0 && v.y === 0) {
        stopJoystickDrive();
        return;
      }
      if (joystickTimerRef.current !== null) return; // already driving
      const STEP = 0.0025; // metres per tick at full deflection (~0.15 m/s)
      joystickTimerRef.current = setInterval(() => {
        const { x, y } = joystickVecRef.current;
        if (x === 0 && y === 0) return;
        nudgePosition([x * STEP, 0, y * STEP]);
      }, 16);
    },
    [nudgePosition, stopJoystickDrive]
  );

  // Stop driving when locked, when leaving Align mode, or on unmount.
  useEffect(() => {
    if (state.locked || !precisionMode) stopJoystickDrive();
  }, [state.locked, precisionMode, stopJoystickDrive]);
  useEffect(() => stopJoystickDrive, [stopJoystickDrive]);

  // ── Per-part inspection (tap a part box in 'parts' overlay mode) ──
  const logPart = useCallback(
    async (meshName: string, status: 'pass' | 'fail' | 'warning') => {
      try {
        await createQuality({
          modelId,
          meshName,
          status,
          inspector: inspectorName,
          notes: `AR per-part inspection${confidenceTag()}`,
        });
        notifySuccess(`${meshName}: ${status}`);
      } catch (e) {
        notifyError();
        Alert.alert('Could not save', e instanceof Error ? e.message : 'Failed to save result');
      }
    },
    [createQuality, modelId, inspectorName, confidenceTag],
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

  // ── Deviation probe → QA measurement (backend auto-fails out-of-tolerance) ──
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
      });
      setMeasurements((m) => ({ ...m, deviationModelPoint: null, deviationRealPoint: null }));
      notifySuccess();
      Alert.alert('Logged', `Deviation of ${mm} mm recorded.`);
    } catch (e) {
      notifyError();
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Failed to save deviation');
    }
  }, [measurements.deviationModelPoint, measurements.deviationRealPoint, createQuality, modelId, focusMeshName, inspectorName, confidenceTag]);

  // ── Evidence: capture the live AR view and attach it to a QA entry ──
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

  // ── Sign-off decisions (permission-gated; identity stamped server-side) ──
  // NCRs are raised separately via an NCR-type QC report (Report Templates →
  // fill → reflects in QC Reports), not from the AR sign-off flow.
  const handleSignoff = useCallback(
    (entry: ARQualityEntry) => {
      if (!can('quality-analysis.signoff')) {
        Alert.alert('Sign-off', 'Your role cannot approve/reject inspections — a reviewer with sign-off permission will pick this up.');
        return;
      }
      Alert.alert(`Sign off — ${entry.meshName}`, `Current status: ${entry.status.toUpperCase()}`, [
        { text: 'Approve', onPress: () => { void signoffQuality(entry.id, 'approved'); } },
        { text: 'Reject', style: 'destructive', onPress: () => { void signoffQuality(entry.id, 'rejected'); } },
        { text: 'Cancel', style: 'cancel' },
      ]);
    },
    [signoffQuality],
  );

  // ── Persisted registration: restore the model's last scale/rotation/render
  // mode for this modelId on open; position is intentionally not restored. ──
  const restoredRef = useRef(false);
  useEffect(() => {
    restoredRef.current = false;
  }, [modelId]);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    (async () => {
      const reg = await loadRegistration(modelId);
      if (!reg) return;
      baseScaleRef.current = reg.scale;
      setScale(reg.scale);
      baseRotationRef.current = reg.rotation;
      setRotation(reg.rotation);
      setRenderMode(reg.renderMode); // reducer ignores 'wireframe' if none available
    })();
  }, [modelId, baseScaleRef, setScale, setRotation, setRenderMode]);

  // Save registration whenever the placed model's transform / render mode change.
  useEffect(() => {
    if (!state.placed) return;
    void saveRegistration(modelId, {
      scale: state.scale,
      rotation: state.rotation,
      renderMode: state.renderMode,
    });
  }, [state.placed, state.scale, state.rotation, state.renderMode, modelId]);

  // World-mode recovery: drop the placement so the user can re-tap to re-drop
  // the model at the current (re-localized) camera position. Scale, rotation
  // and render mode are preserved. Only reachable while unlocked.
  const handleReplace = useCallback(() => {
    setPlaced(false);
    setDriftSuspected(false);
  }, [setPlaced]);

  // Switch tracking mode live. Each mode anchors differently (free placement /
  // detected plane / image marker) and configures the AR session accordingly,
  // so we drop the current placement + measurements; the navigator is keyed by
  // mode (below) and restarts cleanly into the new strategy. Scale, rotation
  // and render mode are kept so the model looks the same after the switch.
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

  const handleReset = () => {
    baseScaleRef.current = [0.2, 0.2, 0.2];
    baseRotationRef.current = [0, 0, 0];
    setDriftSuspected(false);
    // Also clear ARKit's anchors and tracking so a wedged session recovers,
    // not just the model transform.
    try {
      navigatorRef.current?._resetARSession?.(true, true);
    } catch (err) {
      if (__DEV__) console.warn('resetARSession failed:', err);
    }
    reset();
  };

  if (!ViroARSceneNavigator) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>AR is not available on this build.</Text>
      </View>
    );
  }

  if (!state.uri) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading model...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header chrome — hidden during locked inspection for a clean 360° view. */}
      {!state.locked && (
        <>
          <TouchableOpacity style={styles.backButton} onPress={onBack}>
            <Text style={styles.backButtonText}>{'< Back'}</Text>
          </TouchableOpacity>

          <View style={styles.modelNameContainer}>
            <Text style={styles.modelNameText} numberOfLines={1}>
              {state.fileName}
            </Text>
            {/* Diagnostics: surfaces the GLB load result + measured size so we
                can tell a load failure from a scale problem on-device. */}
            <Text style={styles.modelNameText} numberOfLines={1}>
              {`model: ${modelStatus}`}
            </Text>
          </View>

          {onViewRecords && (
            <TouchableOpacity style={styles.recordsButton} onPress={onViewRecords}>
              <Text style={styles.recordsButtonText}>Records</Text>
            </TouchableOpacity>
          )}

          {/* Live tracking-mode switcher — load/compare World · Plane · Image
              anchoring right here, no separate picker screen. */}
          <View style={styles.switcherRow} pointerEvents="box-none">
            <TrackingModeSwitcher value={trackingMode} onChange={handleSelectMode} />
          </View>
        </>
      )}

      {/* AR Scene. The navigator is mounted ONCE and never re-keyed: remounting
          it tears down the GLSurfaceView + renderer on the GL thread, which
          races and crashes (onSurfaceChanged NPE / shader-load SIGSEGV).
          All three modes share ONE scene graph and the SAME tap-to-place flow
          (see ARModelScene). Switching modes only changes the tracking preset
          live — worldAlignment here + anchorDetectionTypes on the scene — so
          there is no scene-graph swap, which keeps switching stable. */}
      <ViroARSceneNavigator
        ref={navigatorRef}
        worldAlignment={
          trackingMode === 'world'
            ? 'Camera'
            : trackingMode === 'image'
              ? 'GravityAndHeading'
              : 'Gravity'
        }
        autofocus={true}
        videoQuality="High"
        depthEnabled={true}
        hdrEnabled={true}
        pbrEnabled={true}
        shadowsEnabled={true}
        occlusionMode={
          occlusionOn && caps.hasDepthSensor && state.renderMode === 'solid'
            ? 'depthBased'
            : 'disabled'
        }
        initialScene={{
          scene: ARModelScene as any,
        }}
        viroAppProps={{
          modelUri: state.uri,
          wireframeUri: state.wireframeUri,
          renderMode: state.renderMode,
          trackingMode,
          placed: state.placed,
          position: state.position,
          scale: state.scale,
          rotation: state.rotation,
          locked: state.locked,
          dimensions,
          measurements,
          qualityEntries,
          onPlace: handlePlace,
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
        }}
        style={styles.arView}
      />

      {/* Banner stack: device-capability notice, live tracking state, and
          drift recovery. Rendered as a single column so notices never overlap. */}
      {!state.locked && (
        <View style={styles.bannerStack} pointerEvents="box-none">
          {/* No-LiDAR notice (iOS only). Dismissible. */}
          {Platform.OS === 'ios' &&
            caps.checked &&
            !caps.hasDepthSensor &&
            !capWarningDismissed && (
              <View style={[styles.banner, styles.bannerWarn]}>
                <Text style={styles.bannerText}>
                  No LiDAR depth sensor on this device. For a stable overlay use
                  Image-Marker mode in good lighting; real-world measurements are
                  approximate.
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

          {/* Live tracking-state banner (transient). */}
          {trackingStatus !== 'normal' && (
            <View style={[styles.banner, styles.bannerWarn]}>
              <Text style={styles.bannerText}>
                {trackingStatus === 'limited'
                  ? 'Tracking limited — move device slowly side-to-side in a well-lit area'
                  : 'Tracking unavailable — check lighting and keep the camera on textured surroundings'}
              </Text>
            </View>
          )}

          {/* Drift recovery (world mode, after tracking has recovered). Anchored
              modes self-relocalize, so this only appears for unanchored world mode. */}
          {driftSuspected &&
            state.placed &&
            trackingMode === 'world' &&
            trackingStatus === 'normal' && (
              <View style={[styles.banner, styles.bannerInfo]}>
                <Text style={[styles.bannerText, styles.bannerTextOnInfo]}>
                  Tracking was interrupted — the model may have drifted out of
                  alignment.
                </Text>
                <TouchableOpacity
                  style={styles.bannerAction}
                  onPress={handleReplace}
                >
                  <Text style={styles.bannerActionText}>Re-place</Text>
                </TouchableOpacity>
              </View>
            )}
        </View>
      )}

      {/* AR-QA visualization rail — overlay mode, focus, and (LiDAR) occlusion.
          Hidden while the measure panel is open (they share the screen edge). */}
      {state.placed && !state.locked && !measurePanelOpen && (
        <View style={styles.vizRail} pointerEvents="box-none">
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

          {caps.hasDepthSensor && (
            <TouchableOpacity
              style={[styles.vizButton, occlusionOn && styles.vizButtonActive]}
              onPress={() => setOcclusionOn((o) => !o)}
              activeOpacity={0.7}
            >
              <Text style={styles.vizButtonText}>{occlusionOn ? 'Occlude On' : 'Occlude'}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Capture-confidence badge + offline-queue sync pill (bottom-center).
          box-none so the camera/scene stays interactive everywhere except on
          the tappable pill itself; the confidence badge is non-interactive. */}
      {!state.locked && (confidence || pendingCount > 0) && (
        <View style={styles.bottomCenter} pointerEvents="box-none">
          {confidence && (
            <View
              pointerEvents="none"
              style={[
                styles.confidenceBadge,
                confidence === 'high'
                  ? styles.confHigh
                  : confidence === 'medium'
                    ? styles.confMedium
                    : styles.confLow,
              ]}
            >
              <Text
                style={[styles.confidenceText, confidence === 'low' && styles.confTextLight]}
              >
                {confidence === 'high'
                  ? 'LiDAR · high accuracy'
                  : confidence === 'medium'
                    ? 'No LiDAR · approximate'
                    : 'Tracking poor · hold steady'}
              </Text>
            </View>
          )}
          {pendingCount > 0 && (
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
                {syncingQueue
                  ? 'Syncing…'
                  : `${pendingCount} queued offline · tap to sync`}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Tilt (left) + Scale (right, above joystick) + Joystick (right) — Align mode. */}
      {precisionMode && state.placed && !state.locked && (
        <>
          <View style={styles.tiltContainer} pointerEvents="box-none">
            <TiltControls
              rotation={state.rotation}
              locked={state.locked}
              onRotationChange={(r) => {
                baseRotationRef.current = r;
                setRotation(r);
              }}
            />
          </View>
          <View style={styles.scaleContainer} pointerEvents="box-none">
            <ScaleControls
              scale={state.scale}
              locked={state.locked}
              onScaleChange={handleScaleChange}
            />
          </View>
          <View style={styles.joystickContainer} pointerEvents="box-none">
            <Joystick onChange={handleJoystickChange} />
          </View>
        </>
      )}

      {/* Measurement Panel — hidden during locked inspection. */}
      {!state.locked && measurePanelOpen && (
        <MeasurementPanel
          measurements={measurements}
          dimensions={dimensions}
          onChange={updateMeasurements}
          onClearRulers={clearRulers}
          onLogDeviation={handleLogDeviation}
        />
      )}

      {/* Lock/Unlock button — visible in Align mode and while locked. */}
      {state.placed && (precisionMode || state.locked) && (
        <TouchableOpacity
          style={styles.lockButton}
          onPress={toggleLock}
          activeOpacity={0.7}
        >
          <Text style={styles.lockButtonText}>
            {state.locked ? 'Unlock' : 'Lock'}
          </Text>
        </TouchableOpacity>
      )}

      {/* Toolbar Overlay — hidden during locked inspection. */}
      {!state.locked && (
        <ToolBar
          locked={state.locked}
          placed={state.placed}
          modelLoaded={!!state.uri}
          precisionMode={precisionMode}
          measurePanelOpen={measurePanelOpen}
          renderMode={state.renderMode}
          hasWireframe={!!state.wireframeUri}
          onToggleLock={toggleLock}
          onTogglePrecision={() => setPrecisionMode((p) => !p)}
          onToggleMeasure={() => setMeasurePanelOpen((o) => !o)}
          onCycleRenderMode={cycleRenderMode}
          onToggleEdges={toggleEdgesMode}
          onReset={handleReset}
        />
      )}

      {/* QA review panel toggle — list / sign-off / evidence / NCR. */}
      {state.placed && (
        <TouchableOpacity
          style={styles.qaButton}
          onPress={() => setQaPanelOpen((o) => !o)}
          activeOpacity={0.7}
        >
          <Text style={styles.qaButtonText}>{qaPanelOpen ? 'Close QA' : 'QA'}</Text>
        </TouchableOpacity>
      )}

      {/* Primary QA action — one tap to record an inspection while scanning.
          Bottom-center so it's thumb-reachable. Hidden in Align mode (the
          tilt d-pad + joystick own the bottom band there) and while the QA
          panel is open. */}
      {state.placed && !qaPanelOpen && !precisionMode && (
        <View style={styles.logQaWrap} pointerEvents="box-none">
          <TouchableOpacity
            style={styles.logQaButton}
            onPress={() => setLogFormOpen(true)}
            activeOpacity={0.85}
          >
            <Text style={styles.logQaButtonText}>＋ Log QA</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* QA inspection panel. */}
      {state.placed && qaPanelOpen && (
        <QualityPanel
          entries={qualityEntries}
          loading={qualityLoading}
          onClose={() => setQaPanelOpen(false)}
          onLogNew={() => setLogFormOpen(true)}
          onSignoff={handleSignoff}
          onCaptureEvidence={handleCaptureEvidence}
        />
      )}

      {/* Log-inspection modal (controls its own visibility). */}
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
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  arView: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
    padding: 24,
  },
  loadingText: {
    color: '#ffffff',
    fontSize: 16,
    textAlign: 'center',
  },
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
  backButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  modelNameContainer: {
    position: 'absolute',
    top: 52,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 90,
    zIndex: 10,
  },
  modelNameText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    maxWidth: '100%',
  },
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
  recordsButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  // Dedicated full-width row under the top bar for the tracking-mode switcher,
  // so it never collides with the corner buttons.
  switcherRow: {
    position: 'absolute',
    top: 92,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 24,
  },
  // Primary "Log QA" floating action button (bottom-center, above the toolbar).
  logQaWrap: {
    position: 'absolute',
    bottom: 160,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 26,
  },
  logQaButton: {
    backgroundColor: 'rgba(16, 185, 129, 0.95)',
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 26,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  logQaButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  // Notices stack below the top button row (QA / Lock at top: 96) so they
  // don't sit underneath those controls.
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
  bannerWarn: {
    backgroundColor: 'rgba(234, 179, 8, 0.92)',
  },
  bannerInfo: {
    backgroundColor: 'rgba(59, 130, 246, 0.95)',
  },
  bannerText: {
    flex: 1,
    color: '#1f2937',
    fontSize: 15,
    fontWeight: '700',
  },
  bannerTextOnInfo: {
    color: '#ffffff',
  },
  bannerDismiss: {
    marginLeft: 10,
    paddingHorizontal: 4,
  },
  bannerDismissText: {
    color: '#1f2937',
    fontSize: 15,
    fontWeight: '800',
  },
  bannerAction: {
    marginLeft: 12,
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 18,
  },
  bannerActionText: {
    color: '#1d4ed8',
    fontSize: 14,
    fontWeight: '800',
  },
  tiltContainer: {
    position: 'absolute',
    left: 16,
    bottom: 160,
    zIndex: 20,
  },
  scaleContainer: {
    position: 'absolute',
    right: 16,
    bottom: 280,
    zIndex: 20,
  },
  joystickContainer: {
    position: 'absolute',
    right: 16,
    bottom: 160,
    zIndex: 20,
  },
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
  lockButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
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
  qaButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  vizRail: {
    position: 'absolute',
    right: 12,
    top: 248,
    gap: 8,
    zIndex: 18,
  },
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
  vizButtonActive: {
    backgroundColor: 'rgba(14, 165, 233, 0.92)',
  },
  vizButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  bottomCenter: {
    position: 'absolute',
    bottom: 92,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 6,
    zIndex: 15,
  },
  confidenceBadge: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  confHigh: { backgroundColor: 'rgba(16, 185, 129, 0.92)' },
  confMedium: { backgroundColor: 'rgba(245, 158, 11, 0.92)' },
  confLow: { backgroundColor: 'rgba(239, 68, 68, 0.92)' },
  confidenceText: {
    color: '#0b1220',
    fontSize: 15,
    fontWeight: '800',
  },
  confTextLight: {
    color: '#ffffff',
  },
  // Offline-sync pill — high-contrast amber so a growing queue is impossible to
  // miss, sized as a real tap target with a refresh affordance.
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
  queueChipBusy: {
    backgroundColor: 'rgba(245, 158, 11, 0.75)',
  },
  queueChipIcon: {
    color: '#0b1220',
    fontSize: 18,
    fontWeight: '900',
  },
  queueChipText: {
    color: '#0b1220',
    fontSize: 15,
    fontWeight: '800',
  },
});