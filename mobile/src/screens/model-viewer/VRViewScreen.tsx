import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { ModelsStackParamList } from '../../navigation/types';

type Route = RouteProp<ModelsStackParamList, 'VRView'>;
type Vec3 = [number, number, number];

// Lazy-load ViroVRSceneNavigator — crashes in Expo Go
let ViroVRSceneNavigator: any = null;
try {
  ViroVRSceneNavigator = require('@reactvision/react-viro').ViroVRSceneNavigator;
} catch {
  // Viro not available
}

export function VRViewScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation();
  const { modelId, modelName, fileUrl } = route.params;

  const [modelStatus, setModelStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [scale, setScale] = useState<Vec3>([1, 1, 1]);
  const [rotation, setRotation] = useState<Vec3>([0, 0, 0]);

  const lastScaleRef = useRef(1);

  const handleDrag = useCallback((_position: Vec3) => {
    // Model follows gaze/controller in VR — drag updates position
  }, []);

  const handlePinch = useCallback((pinchState: number, scaleFactor: number) => {
    if (pinchState === 3) {
      // End — lock in the new scale
      lastScaleRef.current = lastScaleRef.current * scaleFactor;
      return;
    }
    const newScale = lastScaleRef.current * scaleFactor;
    const clamped = Math.max(0.1, Math.min(5, newScale));
    setScale([clamped, clamped, clamped]);
  }, []);

  const handleRotate = useCallback((rotateState: number, rotationFactor: number) => {
    if (rotateState === 3) return; // End
    setRotation((prev) => [prev[0], prev[1] + rotationFactor, prev[2]]);
  }, []);

  const handleModelStatus = useCallback((status: string) => {
    setModelStatus(status as any);
  }, []);

  const resetView = useCallback(() => {
    setScale([1, 1, 1]);
    setRotation([0, 0, 0]);
    lastScaleRef.current = 1;
  }, []);

  if (!ViroVRSceneNavigator) {
    return (
      <View style={styles.fallback}>
        <Ionicons name="warning-outline" size={48} color={Colors.warning} />
        <Text style={styles.fallbackTitle}>VR Not Available</Text>
        <Text style={styles.fallbackText}>
          VR mode requires a native build with the Viro engine.{'\n'}
          Run: eas build --profile quest --platform android
        </Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ViroVRSceneNavigator
        initialScene={{
          scene: require('./VRModelScene').default,
        }}
        viroAppProps={{
          modelUri: fileUrl,
          scale,
          rotation,
          onDrag: handleDrag,
          onPinch: handlePinch,
          onRotate: handleRotate,
          onModelStatus: handleModelStatus,
        }}
        style={styles.vr}
      />

      {/* Status overlay */}
      {modelStatus === 'loading' && (
        <View style={styles.statusOverlay}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.statusText}>Loading {modelName}...</Text>
        </View>
      )}

      {modelStatus === 'error' && (
        <View style={styles.statusOverlay}>
          <Ionicons name="alert-circle" size={32} color={Colors.danger} />
          <Text style={[styles.statusText, { color: Colors.danger }]}>
            Failed to load model
          </Text>
        </View>
      )}

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity style={styles.controlBtn} onPress={resetView}>
          <Ionicons name="refresh" size={22} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.controlBtn, { backgroundColor: Colors.danger }]}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="close" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Model name label */}
      <View style={styles.label}>
        <Text style={styles.labelText} numberOfLines={1}>
          {modelName}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  vr: { flex: 1 },
  fallback: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  fallbackTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.text,
    marginTop: 16,
  },
  fallbackText: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 20,
  },
  backBtn: {
    marginTop: 24,
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  backBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  statusOverlay: {
    position: 'absolute',
    top: '40%',
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    gap: 8,
  },
  statusText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  controls: {
    position: 'absolute',
    right: 16,
    bottom: 32,
    gap: 12,
  },
  controlBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  label: {
    position: 'absolute',
    top: 20,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  labelText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
