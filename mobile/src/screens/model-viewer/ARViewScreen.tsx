// AR QA Inspector — hosts the ported glb-viewer AR experience.
//
// The previous WebXR-handoff / WebView fallback implementation was replaced
// with glb-viewer's tested Viro-based AR (wireframe / ghost / solid overlay,
// model + real-world rulers, dimension overlays, align/scale/tilt controls).
// The model is downloaded from the PCS backend (`/api/models/:id/file`) and
// prepared on-device; navigation params and the link into Quality Inspection
// are preserved so AR remains part of the QA stage.
import React, { useState, useCallback } from 'react';
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
import { ModelsStackParamList } from '../../navigation/types';
import { useRemoteModel } from './ar/useRemoteModel';
import ARExperience from './ar/ARExperience';
import TrackingModePicker from './ar/TrackingModePicker';
import { TrackingMode } from './ar/types';

type Route = RouteProp<ModelsStackParamList, 'ARView'>;
type Nav = NativeStackNavigationProp<ModelsStackParamList, 'ARView'>;

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
  const { modelId, fileUrl } = route.params;

  const [pickerVisible, setPickerVisible] = useState(false);
  const [trackingMode, setTrackingMode] = useState<TrackingMode | null>(null);

  const { model, loading, error, progress } = useRemoteModel(fileUrl, modelId);

  const startSession = useCallback(() => setPickerVisible(true), []);
  const handleModeSelected = useCallback((mode: TrackingMode) => {
    setTrackingMode(mode);
    setPickerVisible(false);
  }, []);
  const handleBackToIntro = useCallback(() => setTrackingMode(null), []);

  const openQualityData = useCallback(() => {
    navigation.navigate('QualityView', {
      modelId,
      modelName: model?.fileName ?? 'Model',
      fileUrl,
    });
  }, [navigation, modelId, model, fileUrl]);

  // ── In the live AR session ──
  if (trackingMode && model) {
    return (
      <ARExperience
        modelId={modelId}
        modelUri={model.uri}
        fileName={model.fileName}
        wireframeUri={model.wireframeUri}
        dimensions={model.dimensions}
        trackingMode={trackingMode}
        onBack={handleBackToIntro}
      />
    );
  }

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

  // ── Ready: intro / launch screen ──
  return (
    <View style={styles.container}>
      <Ionicons name="glasses-outline" size={64} color={Colors.primary} />
      <Text style={styles.titleText}>AR QA Inspector</Text>
      <Text style={styles.descText}>
        Overlay the model on your real product and walk around to inspect it.{'\n'}
        Toggle wireframe edges, then measure against the physical part.
      </Text>

      <TouchableOpacity style={styles.primaryButton} onPress={startSession}>
        <Ionicons name="scan" size={22} color={Colors.white} />
        <Text style={styles.primaryButtonText}>Start AR Session</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.secondaryButton} onPress={openQualityData}>
        <Ionicons name="clipboard-outline" size={20} color={Colors.primary} />
        <Text style={styles.secondaryButtonText}>View Quality Inspection</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
        <Text style={styles.backButtonText}>Cancel</Text>
      </TouchableOpacity>

      <TrackingModePicker
        visible={pickerVisible}
        fileName={model.fileName}
        onSelect={handleModeSelected}
        onCancel={() => setPickerVisible(false)}
      />
    </View>
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
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 12,
    width: '100%',
    gap: 10,
    marginTop: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  secondaryButtonText: { color: Colors.text, fontSize: 15, fontWeight: '700' },
  backButton: { marginTop: 20, padding: 12 },
  backButtonText: { color: Colors.primary, fontSize: 15, fontWeight: '600' },
});