// AR QA Inspector host.
//
// Camera-first: when Viro is available this mounts the AR experience DIRECTLY —
// the live camera opens immediately and the model streams in over it (handled
// inside ARExperience via useRemoteModel). There is no pre-camera "Preparing
// model…" screen anymore; download / prepare / error are all shown as light
// overlays on top of the running camera.
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { ViewerScreenParams } from '../../navigation/types';
import ARExperience from './ar/ARExperience';
import EngineSwitcher from './ar/EngineSwitcher';
import { useDeviceCapabilities } from './ar/useDeviceCapabilities';
import { Engine } from './ar/types';
import { ErrorBoundary } from '../../components/ErrorBoundary';

// Master switch for the native RealityKit (LiDAR) engine. Flip to false to hide
// it everywhere and fall back to Viro-only with zero other changes.
const REALITYKIT_ENGINE_ENABLED = true;

// The Standard (Viro) engine is unused in the demo, so the Standard↔LiDAR switcher
// is hidden — LiDAR (the default) is the only engine offered. Flip to true to bring
// the toggle back once Standard is needed again.
const SHOW_ENGINE_SWITCHER = false;

type Route = RouteProp<ViewerScreenParams, 'ARView'>;
type Nav = NativeStackNavigationProp<ViewerScreenParams, 'ARView'>;

// Detect whether the native Viro module is present (absent in Expo Go / web).
let viroAvailable = false;
try {
  viroAvailable = !!require('@reactvision/react-viro').ViroARSceneNavigator;
} catch {
  viroAvailable = false;
}

export function ARViewScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const { modelId, fileUrl, meshNames, partLabel, assemblyNodeId, projectId, stageId, workOrderStageId } = route.params;
  const modelName = partLabel || 'Model';

  // The native LiDAR engine is iPad + LiDAR only (real customers use iPad). On
  // every other device this stays false → the Viro path renders exactly as
  // before and the engine switch never appears (no dead UI).
  const caps = useDeviceCapabilities();
  const supportsRealityKit =
    REALITYKIT_ENGINE_ENABLED && caps.checked && caps.isPad && caps.hasDepthSensor;
  // LiDAR (RealityKit) is the DEFAULT engine. On an iPad with a depth sensor it
  // mounts first; on every other device `supportsRealityKit` is false so the
  // Viro path renders instead (unchanged behavior). The EngineSwitcher still lets
  // the operator flip to Viro to compare.
  const [engine, setEngine] = useState<Engine>('realitykit');
  // Both experiences dock their tool panels low; hide the engine switcher while a
  // panel is open so it never sits under one. Set by whichever experience is mounted.
  const [panelOpen, setPanelOpen] = useState(false);

  const openQualityData = useCallback(() => {
    navigation.navigate('QualityView', { modelId, modelName, fileUrl });
  }, [navigation, modelId, modelName, fileUrl]);

  // ── Viro not available (Expo Go / web) → offer the 3D viewer instead ──
  if (!viroAvailable) {
    return (
      <View style={styles.container}>
        <Ionicons name="cube-outline" size={64} color={Colors.primary} />
        <Text style={styles.titleText}>AR QA Inspector</Text>
        <Text style={styles.descText}>
          In-app AR needs a development build (Viro isn't available in Expo Go). You can still
          inspect the model in the 3D viewer.
        </Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => navigation.navigate('ModelView', { modelId, modelName, fileUrl })}
        >
          <Ionicons name="cube" size={22} color={Colors.white} />
          <Text style={styles.primaryButtonText}>Open 3D Viewer</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Wait for the one-tick capability probe before mounting an engine. ──
  // The default engine is RealityKit, so without this gate the first render
  // (caps not yet checked → supportsRealityKit false) would briefly mount the
  // Viro ARKit session, then tear it down to start RealityKit's — two ARKit
  // sessions contending. The probe resolves synchronously on the first effect,
  // so this is a single frame.
  if (!caps.checked) {
    return (
      <View style={[styles.fill, styles.starting]}>
        <ActivityIndicator color={Colors.white} />
        <Text style={styles.startingText}>Starting AR…</Text>
      </View>
    );
  }

  // ── Open the live AR session immediately; the model loads over the camera. ──
  // A nested boundary keeps a JS error in the AR/Viro tree from unwinding to the
  // root boundary (which would blank the whole app). Native (SIGSEGV) crashes
  // aren't JS-catchable.
  //
  // Engine selection (iPad + LiDAR only): the default is the native RealityKit/
  // LiDAR engine; an EngineSwitcher lets the user flip to Viro to compare. The
  // RealityKit experience is lazy-required so it (and the native module it pulls
  // in) never loads on non-LiDAR builds, Expo Go, or in tests. If that module is
  // missing from the build, RkExperience stays null and the Viro path renders.
  const useRealityKit = engine === 'realitykit' && supportsRealityKit;
  let RkExperience: React.ComponentType<any> | null = null;
  if (useRealityKit) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      RkExperience = require('./ar/ARExperienceRK').default;
    } catch {
      RkExperience = null; // module not in this build → fall back to Viro below
    }
  }

  return (
    <ErrorBoundary
      title="AR session error"
      message="The AR view hit an unexpected problem. Any saved inspections are safe — go back and reopen to try again."
      resetLabel="Go back"
      onReset={() => navigation.goBack()}
    >
      <View style={styles.fill}>
        {useRealityKit && RkExperience ? (
          <RkExperience
            modelId={modelId}
            fileUrl={fileUrl}
            fileName={`${modelName}.glb`}
            meshNames={meshNames && meshNames.length ? meshNames : null}
            partLabel={partLabel}
            qaContext={{ assemblyNodeId, projectId, stageId, workOrderStageId }}
            onViewRecords={openQualityData}
            onBack={() => navigation.goBack()}
            onChromeBusy={setPanelOpen}
          />
        ) : (
          <ARExperience
            modelId={modelId}
            fileUrl={fileUrl}
            fileName={`${modelName}.glb`}
            meshNames={meshNames && meshNames.length ? meshNames : null}
            partLabel={partLabel}
            initialTrackingMode="plane"
            qaContext={{ assemblyNodeId, projectId, stageId, workOrderStageId }}
            onViewRecords={openQualityData}
            onBack={() => navigation.goBack()}
            onChromeBusy={setPanelOpen}
          />
        )}

        {SHOW_ENGINE_SWITCHER && supportsRealityKit && !panelOpen && (
          <EngineSwitcher value={engine} onChange={setEngine} style={styles.engineSwitchLow} />
        )}
      </View>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  starting: { backgroundColor: '#000', justifyContent: 'center', alignItems: 'center', gap: 12 },
  startingText: { color: Colors.white, fontSize: 15, fontWeight: '600' },
  // Engine toggle pinned low-center, above the Viro toolbar; only shown on
  // iPad + LiDAR. Tweak `bottom` on-device if it overlaps an open tool panel.
  // Engine switcher at the bottom edge; the host hides it while a tool panel is
  // open (both experiences dock panels low), so there's never an overlap.
  engineSwitchLow: { position: 'absolute', bottom: 30, left: 0, right: 0, zIndex: 50 },
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  titleText: { fontSize: 24, fontWeight: '700', color: Colors.text, marginTop: 16 },
  descText: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 20,
    marginBottom: 24,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 12,
    width: '100%',
    gap: 12,
  },
  primaryButtonText: { color: Colors.white, fontSize: 16, fontWeight: '700' },
  backButton: { marginTop: 20, padding: 12 },
  backButtonText: { color: Colors.primary, fontSize: 15, fontWeight: '600' },
});
