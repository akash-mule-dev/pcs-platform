import React, { useCallback, useState } from 'react';
import { View, Text } from 'react-native';

// Lazy-load Viro components — they crash in Expo Go
let ViroARScene: any = null;
let ViroAmbientLight: any = null;
let ViroDirectionalLight: any = null;
let Viro3DObject: any = null;
let ViroNode: any = null;
let ViroTrackingStateConstants: any = null;

try {
  const viro = require('@reactvision/react-viro');
  ViroARScene = viro.ViroARScene;
  ViroAmbientLight = viro.ViroAmbientLight;
  ViroDirectionalLight = viro.ViroDirectionalLight;
  Viro3DObject = viro.Viro3DObject;
  ViroNode = viro.ViroNode;
  ViroTrackingStateConstants = viro.ViroTrackingStateConstants;
} catch {
  // Viro not available
}

type Vec3 = [number, number, number];

interface SceneProps {
  sceneNavigator: {
    viroAppProps: {
      modelUri: string;
      placed: boolean;
      position: Vec3;
      scale: Vec3;
      rotation: Vec3;
      locked: boolean;
      onPlaced: (position: Vec3) => void;
      onDrag: (position: Vec3) => void;
      onPinch: (pinchState: number, scaleFactor: number) => void;
      onRotate: (rotateState: number, rotationFactor: number) => void;
      onModelStatus: (status: string) => void;
      onTrackingUpdated: (state: string) => void;
    };
  };
}

function ARModelScene(props: SceneProps) {
  if (!ViroARScene) {
    return <View><Text>AR not available</Text></View>;
  }

  const [trackingReady, setTrackingReady] = useState(false);

  const {
    modelUri,
    placed,
    position,
    scale,
    rotation,
    locked,
    onPlaced,
    onDrag,
    onPinch,
    onRotate,
    onModelStatus,
    onTrackingUpdated,
  } = props.sceneNavigator.viroAppProps;


  const handleDrag = useCallback((dragToPos: number[]) => {
    if (!locked) {
      onDrag([dragToPos[0], dragToPos[1], dragToPos[2]] as Vec3);
    }
  }, [locked, onDrag]);

  const handlePinch = useCallback((pinchState: number, scaleFactor: number) => {
    if (!locked) {
      onPinch(pinchState, scaleFactor);
    }
  }, [locked, onPinch]);

  const handleRotate = useCallback((rotateState: number, rotationFactor: number) => {
    if (!locked) {
      onRotate(rotateState, rotationFactor);
    }
  }, [locked, onRotate]);

  const handleTracking = useCallback((state: any) => {
    setTrackingReady(true);
    if (state === ViroTrackingStateConstants.TRACKING_NORMAL) {
      onTrackingUpdated('normal');
    } else if (state === ViroTrackingStateConstants.TRACKING_LIMITED) {
      onTrackingUpdated('limited');
    } else {
      onTrackingUpdated('unavailable');
    }
  }, [onTrackingUpdated]);

  const gestureProps = locked
    ? {}
    : {
        onDrag: handleDrag,
        onPinch: handlePinch,
        onRotate: handleRotate,
      };

  return (
    <ViroARScene onTrackingUpdated={handleTracking}>
      <ViroAmbientLight color="#ffffff" intensity={500} />
      <ViroDirectionalLight
        color="#ffffff"
        direction={[0, -1, -0.5]}
        intensity={600}
      />
      <ViroDirectionalLight
        color="#ffffff"
        direction={[1, -0.5, -1]}
        intensity={200}
      />

      {placed && trackingReady && (
        <ViroNode position={position}>
          <Viro3DObject
            source={{ uri: modelUri }}
            type="GLB"
            position={[0, 0, 0]}
            scale={scale}
            rotation={rotation}
            dragType="FixedToWorld"
            onLoadStart={() => onModelStatus('loading')}
            onLoadEnd={() => onModelStatus('loaded')}
            onError={(event: any) => {
              console.warn('Model load error:', event.nativeEvent);
              onModelStatus('error');
            }}
            {...gestureProps}
          />
        </ViroNode>
      )}
    </ViroARScene>
  );
}

export default ARModelScene;
