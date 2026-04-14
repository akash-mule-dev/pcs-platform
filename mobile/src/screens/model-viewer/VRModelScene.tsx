import React, { useCallback, useState } from 'react';
import { View, Text } from 'react-native';

// Lazy-load Viro components — they crash in Expo Go
let ViroScene: any = null;
let ViroAmbientLight: any = null;
let ViroDirectionalLight: any = null;
let Viro3DObject: any = null;
let ViroNode: any = null;
let ViroText: any = null;
let ViroFlexView: any = null;

try {
  const viro = require('@reactvision/react-viro');
  ViroScene = viro.ViroScene;
  ViroAmbientLight = viro.ViroAmbientLight;
  ViroDirectionalLight = viro.ViroDirectionalLight;
  Viro3DObject = viro.Viro3DObject;
  ViroNode = viro.ViroNode;
  ViroText = viro.ViroText;
  ViroFlexView = viro.ViroFlexView;
} catch {
  // Viro not available (Expo Go)
}

type Vec3 = [number, number, number];

interface SceneProps {
  sceneNavigator: {
    viroAppProps: {
      modelUri: string;
      scale: Vec3;
      rotation: Vec3;
      onDrag: (position: Vec3) => void;
      onPinch: (pinchState: number, scaleFactor: number) => void;
      onRotate: (rotateState: number, rotationFactor: number) => void;
      onModelStatus: (status: string) => void;
    };
  };
}

function VRModelScene(props: SceneProps) {
  if (!ViroScene) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' }}>
        <Text style={{ color: '#fff' }}>VR not available</Text>
      </View>
    );
  }

  const {
    modelUri,
    scale,
    rotation,
    onDrag,
    onPinch,
    onRotate,
    onModelStatus,
  } = props.sceneNavigator.viroAppProps;

  const [loaded, setLoaded] = useState(false);

  const handleDrag = useCallback(
    (dragToPos: number[]) => {
      onDrag([dragToPos[0], dragToPos[1], dragToPos[2]] as Vec3);
    },
    [onDrag],
  );

  const handlePinch = useCallback(
    (pinchState: number, scaleFactor: number) => {
      onPinch(pinchState, scaleFactor);
    },
    [onPinch],
  );

  const handleRotate = useCallback(
    (rotateState: number, rotationFactor: number) => {
      onRotate(rotateState, rotationFactor);
    },
    [onRotate],
  );

  return (
    <ViroScene>
      {/* Lighting */}
      <ViroAmbientLight color="#ffffff" intensity={400} />
      <ViroDirectionalLight
        color="#ffffff"
        direction={[0, -1, -0.5]}
        intensity={700}
        castsShadow={true}
        shadowMapSize={2048}
        shadowNearZ={2}
        shadowFarZ={5}
      />
      <ViroDirectionalLight
        color="#b0c4de"
        direction={[1, -0.5, -1]}
        intensity={250}
      />
      <ViroDirectionalLight
        color="#ffe0b2"
        direction={[-1, 0.5, 1]}
        intensity={150}
      />

      {/* Ground grid for spatial reference */}
      <ViroNode position={[0, -1, 0]}>
        <ViroFlexView
          style={{ flexDirection: 'row' }}
          width={6}
          height={6}
          position={[0, 0, -3]}
          rotation={[-90, 0, 0]}
          backgroundColor="rgba(30, 40, 80, 0.3)"
        />
      </ViroNode>

      {/* Loading text */}
      {!loaded && ViroText && (
        <ViroText
          text="Loading model..."
          position={[0, 0, -3]}
          style={{ fontSize: 20, color: '#ffffff', textAlignVertical: 'center', textAlign: 'center' }}
          width={4}
          height={1}
        />
      )}

      {/* 3D Model — placed 2m in front of user at eye level */}
      <ViroNode position={[0, 0, -2]}>
        <Viro3DObject
          source={{ uri: modelUri }}
          type="GLB"
          position={[0, 0, 0]}
          scale={scale}
          rotation={rotation}
          dragType="FixedDistance"
          onDrag={handleDrag}
          onPinch={handlePinch}
          onRotate={handleRotate}
          onLoadStart={() => onModelStatus('loading')}
          onLoadEnd={() => {
            setLoaded(true);
            onModelStatus('loaded');
          }}
          onError={(event: any) => {
            console.warn('VR Model load error:', event.nativeEvent);
            onModelStatus('error');
          }}
        />
      </ViroNode>
    </ViroScene>
  );
}

export default VRModelScene;
