// Ported from glb-viewer's ARScreen, adapted for PCS:
//   - Viro navigator is lazy-`require`d (Expo Go safe)
//   - the model + wireframe + dimensions arrive as props (downloaded by the
//     host screen from the PCS backend) instead of being read from a local
//     document-picker file.
// All interaction logic (placement, lock, render-mode cycle, measurement
// rulers, align d-pad / scale / tilt / joystick) is unchanged from glb-viewer.
import React, { useRef, useCallback, useState, useEffect } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Alert } from 'react-native';
import ARModelScene from './ARModelScene';
import ToolBar from './ToolBar';
import MeasurementPanel from './MeasurementPanel';
import Joystick from './Joystick';
import ScaleControls from './ScaleControls';
import TiltControls from './TiltControls';
import QualityPanel from './QualityPanel';
import LogInspectionForm, { InspectionFormResult } from './LogInspectionForm';
import { useModelState } from './useModelState';
import { useQualityData, ARQualityEntry } from './useQualityData';
import { useAuth } from '../../../context/AuthContext';
import {
  Vec3,
  TrackingMode,
  TRACKING_MODE_INFO,
  MeasurementState,
  DEFAULT_MEASUREMENTS,
} from './types';
import { ModelDimensions } from './dimensionExtractor';

// Lazy-load the Viro navigator — static import crashes in Expo Go.
let ViroARSceneNavigator: any = null;
try {
  ViroARSceneNavigator = require('@reactvision/react-viro').ViroARSceneNavigator;
} catch {
  // handled by the host screen
}

const MODE_ACCENT: Record<TrackingMode, string> = {
  world: '#64748b',
  plane: '#3b82f6',
  image: '#10b981',
};

interface ARExperienceProps {
  modelId: string;
  modelUri: string;
  fileName: string;
  wireframeUri: string | null;
  dimensions: ModelDimensions | null;
  trackingMode: TrackingMode;
  onBack: () => void;
}

export default function ARExperience({
  modelId,
  modelUri,
  fileName,
  wireframeUri,
  dimensions,
  trackingMode,
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

  // ── QA capture ──
  const { user } = useAuth();
  const inspectorName =
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || undefined;
  const {
    entries: qualityEntries,
    loading: qualityLoading,
    create: createQuality,
    signoff: signoffQuality,
  } = useQualityData(modelId);
  const [qaPanelOpen, setQaPanelOpen] = useState(false);
  const [logFormOpen, setLogFormOpen] = useState(false);
  const [savingInspection, setSavingInspection] = useState(false);
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
      } catch (e) {
        Alert.alert('Could not save', e instanceof Error ? e.message : 'Failed to save inspection');
      } finally {
        setSavingInspection(false);
      }
    },
    [createQuality, modelId, inspectorName],
  );

  const handleSignoff = useCallback(
    (entry: ARQualityEntry) => {
      const who = inspectorName || 'Mobile inspector';
      Alert.alert(`Sign off — ${entry.meshName}`, `Current status: ${entry.status.toUpperCase()}`, [
        { text: 'Approve', onPress: () => { void signoffQuality(entry.id, 'approved', who); } },
        { text: 'Reject', style: 'destructive', onPress: () => { void signoffQuality(entry.id, 'rejected', who); } },
        { text: 'Cancel', style: 'cancel' },
      ]);
    },
    [signoffQuality, inspectorName],
  );

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
    setMeasurements((m) => ({ ...m, modelRulerPoints: [], realRulerPoints: [] }));
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

  const handleReset = () => {
    baseScaleRef.current = [0.2, 0.2, 0.2];
    baseRotationRef.current = [0, 0, 0];
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
          </View>

          <View
            style={[
              styles.modeBadge,
              { backgroundColor: MODE_ACCENT[trackingMode] },
            ]}
          >
            <Text style={styles.modeBadgeText}>
              {TRACKING_MODE_INFO[trackingMode].title}
            </Text>
          </View>
        </>
      )}

      {/* AR Scene */}
      <ViroARSceneNavigator
        autofocus={true}
        videoQuality="High"
        depthEnabled={true}
        hdrEnabled={true}
        pbrEnabled={true}
        shadowsEnabled={true}
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
        }}
        style={styles.arView}
      />

      {/* Tracking-state banner */}
      {!state.locked && trackingStatus !== 'normal' && (
        <View style={styles.trackingBanner}>
          <Text style={styles.trackingBannerText}>
            {trackingStatus === 'limited'
              ? 'Tracking limited — move phone side-to-side in well-lit area'
              : 'Tracking unavailable — check lighting and camera view'}
          </Text>
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

      {/* QA capture — available while inspecting (even when locked). */}
      {state.placed && (
        <TouchableOpacity
          style={styles.qaButton}
          onPress={() => setQaPanelOpen((o) => !o)}
          activeOpacity={0.7}
        >
          <Text style={styles.qaButtonText}>{qaPanelOpen ? 'Close QA' : 'QA'}</Text>
        </TouchableOpacity>
      )}

      {/* QA inspection panel. */}
      {state.placed && qaPanelOpen && (
        <QualityPanel
          entries={qualityEntries}
          loading={qualityLoading}
          onClose={() => setQaPanelOpen(false)}
          onLogNew={() => setLogFormOpen(true)}
          onSignoff={handleSignoff}
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
  modeBadge: {
    position: 'absolute',
    top: 50,
    right: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    zIndex: 20,
  },
  modeBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  trackingBanner: {
    position: 'absolute',
    top: 96,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(234, 179, 8, 0.92)',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    zIndex: 15,
  },
  trackingBannerText: {
    color: '#1f2937',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
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
    top: 96,
    right: 16,
    backgroundColor: 'rgba(239, 68, 68, 0.92)',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 20,
    zIndex: 25,
  },
  lockButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  qaButton: {
    position: 'absolute',
    top: 96,
    left: 16,
    backgroundColor: 'rgba(59, 130, 246, 0.92)',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 20,
    zIndex: 25,
  },
  qaButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
});