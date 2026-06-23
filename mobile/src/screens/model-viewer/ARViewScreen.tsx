// AR QA Inspector host.
//
// Camera-first: when Viro is available this mounts the AR experience DIRECTLY —
// the live camera opens immediately and the model streams in over it (handled
// inside ARExperience via useRemoteModel). There is no pre-camera "Preparing
// model…" screen anymore; download / prepare / error are all shown as light
// overlays on top of the running camera.
import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { ViewerScreenParams } from '../../navigation/types';
import ARExperience from './ar/ARExperience';
import { ErrorBoundary } from '../../components/ErrorBoundary';

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

  // ── Open the live AR session immediately; the model loads over the camera. ──
  // A nested boundary keeps a JS error in the AR/Viro tree from unwinding to the
  // root boundary (which would blank the whole app). Native (SIGSEGV) crashes
  // aren't JS-catchable.
  return (
    <ErrorBoundary
      title="AR session error"
      message="The AR view hit an unexpected problem. Any saved inspections are safe — go back and reopen to try again."
      resetLabel="Go back"
      onReset={() => navigation.goBack()}
    >
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
      />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
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
