// AR QA Inspector — hosts the ported glb-viewer AR experience.
//
// Tapping "AR" on an assembly lands here: the model is downloaded + prepared
// on-device, then the live AR session opens DIRECTLY — no intro/launch screen
// and no blocking "Choose Tracking Mode" picker. The three tracking modes are
// selected inline inside the AR view itself (see TrackingModeSwitcher), so the
// inspector can load the assembly and compare World / Plane / Image stability
// without leaving the camera. The Quality-records view stays one tap away via
// the in-AR header.
import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { ViewerScreenParams } from '../../navigation/types';
import { useRemoteModel } from './ar/useRemoteModel';
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
  const { modelId, fileUrl, meshNames, partLabel } = route.params;

  const { model, loading, error, progress } = useRemoteModel(
    fileUrl,
    modelId,
    partLabel || undefined,
    meshNames && meshNames.length ? meshNames : undefined,
  );

  // Quality records (non-AR 3D viewer) — surfaced as an in-AR header action so
  // it stays reachable now that the launch screen is gone.
  const openQualityData = useCallback(() => {
    navigation.navigate('QualityView', {
      modelId,
      modelName: model?.fileName ?? 'Model',
      fileUrl,
    });
  }, [navigation, modelId, model, fileUrl]);

  // ── Viro not available (Expo Go / web) ──
  if (!viroAvailable) {
    return (
      <View style={styles.container}>
        <Ionicons name="cube-outline" size={64} color={Colors.primary} />
        <Text style={styles.titleText}>AR QA Inspector</Text>
        <Text style={styles.descText}>
          In-app AR needs a development build (Viro isn't available in Expo Go).
          You can still inspect the model in the 3D viewer.
        </Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() =>
            navigation.navigate('ModelView', {
              modelId,
              modelName: model?.fileName ?? 'Model',
              fileUrl,
            })
          }
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

  // ── Preparing the model (download + wireframe + dimensions) ──
  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.titleText}>Preparing model…</Text>
        <Text style={styles.descText}>{progress ?? 'Loading…'}</Text>
      </View>
    );
  }

  // ── Download / preparation failed ──
  if (error || !model) {
    return (
      <View style={styles.container}>
        <Ionicons name="alert-circle-outline" size={64} color={Colors.danger} />
        <Text style={styles.titleText}>Couldn’t load the model</Text>
        <Text style={styles.descText}>{error ?? 'The model file is unavailable.'}</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Ready: open the live AR session directly (mode chosen inline in-AR). ──
  // A nested boundary keeps a JS error in the AR/Viro tree from unwinding to the
  // root boundary (which would blank the whole app); the operator backs out into
  // the still-alive shell instead. Native (SIGSEGV) crashes aren't JS-catchable.
  return (
    <ErrorBoundary
      title="AR session error"
      message="The AR view hit an unexpected problem. Any saved inspections are safe — go back and reopen to try again."
      resetLabel="Go back"
      onReset={() => navigation.goBack()}
    >
      <ARExperience
        modelId={modelId}
        modelUri={model.uri}
        fileName={model.fileName}
        wireframeUri={model.wireframeUri}
        dimensions={model.dimensions}
        initialTrackingMode="plane"
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
