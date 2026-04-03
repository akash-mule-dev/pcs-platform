import React, { useState, useRef, useCallback, useReducer, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Linking,
} from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Camera } from 'expo-camera';
import { Colors } from '../../theme/colors';
import { ModelsStackParamList } from '../../navigation/types';

// Lazy-load Viro AR — it crashes in Expo Go where native modules aren't available
let ViroARSceneNavigator: any = null;
let ARModelScene: any = null;
let viroAvailable = false;
try {
  ViroARSceneNavigator = require('@reactvision/react-viro').ViroARSceneNavigator;
  ARModelScene = require('./ARModelScene').default;
  viroAvailable = true;
} catch {
  viroAvailable = false;
}

// Error boundary to catch native AR crashes gracefully
class ARErrorBoundary extends React.Component<
  { children: React.ReactNode; onError: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: any) {
    console.warn('AR Error Boundary caught:', error);
    this.props.onError();
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

type Route = RouteProp<ModelsStackParamList, 'ARView'>;
type Vec3 = [number, number, number];

// ── State ──
interface ModelState {
  position: Vec3;
  scale: Vec3;
  rotation: Vec3;
  locked: boolean;
}

type Action =
  | { type: 'SET_POSITION'; position: Vec3 }
  | { type: 'SET_SCALE'; scale: Vec3 }
  | { type: 'SET_ROTATION'; rotation: Vec3 }
  | { type: 'TOGGLE_LOCK' }
  | { type: 'RESET' };

const DEFAULT_POSITION: Vec3 = [0, -0.5, -1];
const DEFAULT_SCALE: Vec3 = [0.5, 0.5, 0.5];
const DEFAULT_ROTATION: Vec3 = [0, 0, 0];

function reducer(state: ModelState, action: Action): ModelState {
  switch (action.type) {
    case 'SET_POSITION':
      return state.locked ? state : { ...state, position: action.position };
    case 'SET_SCALE':
      return state.locked ? state : { ...state, scale: action.scale };
    case 'SET_ROTATION':
      return state.locked ? state : { ...state, rotation: action.rotation };
    case 'TOGGLE_LOCK':
      return { ...state, locked: !state.locked };
    case 'RESET':
      return { position: DEFAULT_POSITION, scale: DEFAULT_SCALE, rotation: DEFAULT_ROTATION, locked: false };
    default:
      return state;
  }
}

export function ARViewScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation();
  const { modelId, fileUrl } = route.params;

  const [state, dispatch] = useReducer(reducer, {
    position: DEFAULT_POSITION,
    scale: DEFAULT_SCALE,
    rotation: DEFAULT_ROTATION,
    locked: false,
  });

  const baseScaleRef = useRef<Vec3>(DEFAULT_SCALE);
  const baseRotationRef = useRef<Vec3>(DEFAULT_ROTATION);
  const [modelStatus, setModelStatus] = useState('idle');
  const [tracking, setTracking] = useState('');
  const [sessionActive, setSessionActive] = useState(false);
  const [placed, setPlaced] = useState(false);
  const [cameraPermission, setCameraPermission] = useState<'undetermined' | 'granted' | 'denied'>('undetermined');

  useEffect(() => {
    (async () => {
      const { status } = await Camera.getCameraPermissionsAsync();
      setCameraPermission(status === 'granted' ? 'granted' : 'undetermined');
    })();
  }, []);

  const requestCameraAndStart = useCallback(async () => {
    const { status } = await Camera.requestCameraPermissionsAsync();
    if (status === 'granted') {
      setCameraPermission('granted');
      setSessionActive(true);
    } else {
      setCameraPermission('denied');
    }
  }, []);

  const handlePlaced = useCallback((position: Vec3) => {
    setPlaced(true);
    setModelStatus('loading');
    dispatch({ type: 'SET_POSITION', position });
  }, []);

  const handleDrag = useCallback(
    (position: Vec3) => dispatch({ type: 'SET_POSITION', position }),
    [],
  );

  const handlePinch = useCallback(
    (pinchState: number, scaleFactor: number) => {
      if (state.locked) return;
      if (pinchState === 2) {
        const newScale = baseScaleRef.current.map(
          (s) => Math.max(0.01, Math.min(5, s * scaleFactor)),
        ) as Vec3;
        dispatch({ type: 'SET_SCALE', scale: newScale });
      } else if (pinchState === 3) {
        baseScaleRef.current = state.scale;
      }
    },
    [state.locked, state.scale],
  );

  const handleRotate = useCallback(
    (rotateState: number, rotationFactor: number) => {
      if (state.locked) return;
      if (rotateState === 2) {
        const newRotation: Vec3 = [
          baseRotationRef.current[0],
          baseRotationRef.current[1] + rotationFactor,
          baseRotationRef.current[2],
        ];
        dispatch({ type: 'SET_ROTATION', rotation: newRotation });
      } else if (rotateState === 3) {
        baseRotationRef.current = state.rotation;
      }
    },
    [state.locked, state.rotation],
  );

  const adjustScale = (factor: number) => {
    if (state.locked) return;
    const newScale = state.scale.map(
      (s) => Math.max(0.01, Math.min(5, s * factor)),
    ) as Vec3;
    baseScaleRef.current = newScale;
    dispatch({ type: 'SET_SCALE', scale: newScale });
  };

  if (!viroAvailable) {
    return (
      <View style={styles.container}>
        <Ionicons name="warning-outline" size={64} color={Colors.warning} />
        <Text style={styles.titleText}>AR Not Available</Text>
        <Text style={styles.descText}>
          AR features require a development build.{'\n'}
          They are not supported in Expo Go.
        </Text>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (cameraPermission === 'denied') {
    return (
      <View style={styles.container}>
        <Ionicons name="camera-outline" size={64} color={Colors.danger} />
        <Text style={styles.titleText}>Camera Permission Required</Text>
        <Text style={styles.descText}>
          AR needs camera access to work.{'\n'}
          Please grant camera permission in your device settings.
        </Text>
        <TouchableOpacity
          style={styles.startButton}
          onPress={() => Linking.openSettings()}
        >
          <Ionicons name="settings-outline" size={22} color={Colors.white} />
          <Text style={styles.startButtonText}>Open Settings</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!sessionActive) {
    return (
      <View style={styles.container}>
        <Ionicons name="glasses-outline" size={64} color={Colors.primary} />
        <Text style={styles.titleText}>AR QA Inspector</Text>
        <Text style={styles.descText}>
          Place the 3D model on your manufactured product{'\n'}
          and walk around to inspect from all angles.
        </Text>
        <View style={styles.stepsBox}>
          <Text style={styles.stepBold}>1. Tap anywhere on the camera to place the model</Text>
          <Text style={styles.stepText}>2. Drag to reposition · Pinch to resize</Text>
          <Text style={styles.stepBold}>3. Tap LOCK to anchor the model</Text>
          <Text style={styles.stepText}>4. Walk around — model stays rock-solid</Text>
        </View>
        <TouchableOpacity style={styles.startButton} onPress={requestCameraAndStart}>
          <Ionicons name="play" size={22} color={Colors.white} />
          <Text style={styles.startButtonText}>Start AR Session</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.arContainer}>
      <ARErrorBoundary onError={() => { setSessionActive(false); }}>
        <ViroARSceneNavigator
          autofocus={true}
          initialScene={{
            scene: ARModelScene as any,
          }}
          viroAppProps={{
            modelUri: __DEV__ ? 'http://192.168.1.108:9999/model.glb' : fileUrl, // TODO: remove test override
            placed,
            position: state.position,
            scale: state.scale,
            rotation: state.rotation,
            locked: state.locked,
            onPlaced: handlePlaced,
            onDrag: handleDrag,
            onPinch: handlePinch,
            onRotate: handleRotate,
            onModelStatus: setModelStatus,
            onTrackingUpdated: setTracking,
          }}
          style={styles.arView}
        />
      </ARErrorBoundary>

      {/* Tap overlay to place model */}
      {!placed && (
        <TouchableWithoutFeedback onPress={() => handlePlaced([0, -0.2, -1])}>
          <View style={styles.tapOverlay} />
        </TouchableWithoutFeedback>
      )}

      {/* Status bar */}
      <View
        style={[
          styles.statusBar,
          {
            backgroundColor: !placed
              ? 'rgba(100,100,100,0.85)'
              : state.locked
                ? 'rgba(46,125,50,0.9)'
                : tracking === 'normal'
                  ? 'rgba(21,101,192,0.85)'
                  : 'rgba(100,100,100,0.85)',
          },
        ]}
      >
        <Ionicons
          name={!placed ? 'hand-left' : state.locked ? 'lock-closed' : tracking === 'normal' ? 'move' : 'hourglass'}
          size={16}
          color="#fff"
        />
        <Text style={styles.statusBarText}>
          {!placed
            ? 'Tap anywhere to place the model'
            : state.locked
              ? tracking === 'limited'
                ? 'LOCKED — Tracking limited! Move slowly'
                : 'LOCKED — Walk around to inspect all sides'
              : modelStatus === 'loaded'
                ? 'Drag · Pinch · Twist to position, then LOCK'
                : modelStatus === 'error'
                  ? 'Failed to load model'
                  : 'Loading model...'}
        </Text>
      </View>

      {/* LOCK / UNLOCK */}
      {placed && modelStatus === 'loaded' && (
        <TouchableOpacity
          style={[styles.lockButton, state.locked ? styles.lockButtonLocked : styles.lockButtonUnlocked]}
          onPress={() => dispatch({ type: 'TOGGLE_LOCK' })}
        >
          <Ionicons name={state.locked ? 'lock-open' : 'lock-closed'} size={24} color="#fff" />
          <Text style={styles.lockButtonText}>{state.locked ? 'UNLOCK' : 'LOCK MODEL'}</Text>
        </TouchableOpacity>
      )}

      {/* Side controls */}
      <View style={styles.arControls}>
        {!state.locked && (
          <>
            <TouchableOpacity style={styles.arControlBtn} onPress={() => adjustScale(1.3)}>
              <Ionicons name="add" size={24} color={Colors.white} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.arControlBtn} onPress={() => adjustScale(0.7)}>
              <Ionicons name="remove" size={24} color={Colors.white} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.arControlBtn, { backgroundColor: 'rgba(21,101,192,0.8)' }]}
              onPress={() => {
                baseScaleRef.current = DEFAULT_SCALE;
                baseRotationRef.current = DEFAULT_ROTATION;
                setPlaced(false);
                setModelStatus('idle');
                dispatch({ type: 'RESET' });
              }}
            >
              <Ionicons name="refresh" size={24} color={Colors.white} />
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity
          style={[styles.arControlBtn, { backgroundColor: Colors.danger }]}
          onPress={() => { setSessionActive(false); navigation.goBack(); }}
        >
          <Ionicons name="close" size={24} color={Colors.white} />
        </TouchableOpacity>
      </View>

      {/* Back */}
      <TouchableOpacity style={styles.arBackBtn} onPress={() => navigation.goBack()}>
        <Ionicons name="arrow-back" size={22} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: Colors.background,
    justifyContent: 'center', alignItems: 'center', padding: 32,
  },
  titleText: { fontSize: 24, fontWeight: '700', color: Colors.text, marginTop: 16 },
  descText: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', marginTop: 12, lineHeight: 20 },
  stepsBox: {
    marginTop: 20, backgroundColor: Colors.white, borderRadius: 12, padding: 16, width: '100%',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  stepText: { fontSize: 14, color: Colors.text, paddingVertical: 6, paddingLeft: 4 },
  stepBold: { fontSize: 14, color: Colors.primary, paddingVertical: 6, paddingLeft: 4, fontWeight: '700' },
  startButton: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.primary,
    paddingHorizontal: 28, paddingVertical: 14, borderRadius: 10, marginTop: 24, gap: 8,
  },
  startButtonText: { color: Colors.white, fontSize: 16, fontWeight: '600' },
  backButton: { marginTop: 16, padding: 12 },
  backButtonText: { color: Colors.primary, fontSize: 15, fontWeight: '600' },
  tapOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
  },
  arContainer: { flex: 1, backgroundColor: '#000' },
  arView: { flex: 1 },
  statusBar: {
    position: 'absolute', top: 100, left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 12, paddingHorizontal: 16, borderRadius: 25,
  },
  statusBarText: { color: '#fff', fontSize: 12, fontWeight: '600', flexShrink: 1 },
  lockButton: {
    position: 'absolute', bottom: 30, left: 16, right: 80,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    paddingVertical: 16, borderRadius: 14,
  },
  lockButtonUnlocked: { backgroundColor: 'rgba(21,101,192,0.9)' },
  lockButtonLocked: { backgroundColor: 'rgba(198,40,40,0.9)' },
  lockButtonText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 1 },
  arControls: { position: 'absolute', right: 16, bottom: 100, gap: 12 },
  arControlBtn: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center',
  },
  arBackBtn: {
    position: 'absolute', top: 50, left: 16,
    backgroundColor: 'rgba(0,0,0,0.6)', width: 40, height: 40, borderRadius: 20,
    justifyContent: 'center', alignItems: 'center',
  },
});
