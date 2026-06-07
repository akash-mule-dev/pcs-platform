// Ported from glb-viewer, adapted for PCS: Viro components are lazy-`require`d
// (not statically imported) and material/target registration is guarded so the
// module is safe to import in Expo Go / Jest. Logic is otherwise unchanged:
// solid / ghost / wireframe render modes, world / plane / image tracking,
// model + real-world rulers, and dimension overlays.
import React, { useState, useRef } from 'react';
import { Vec3, RenderMode, TrackingMode, MeasurementState } from './types';
import { ModelDimensions } from './dimensionExtractor';
import {
  OverallDimensionsOverlay,
  PartDimensionsOverlay,
  RulerOverlay,
} from './MeasurementOverlays';
import { QualityStatusOverlay } from './QualityStatusOverlay';
import { ARQualityEntry } from './useQualityData';

// Lazy-load Viro — static imports crash in Expo Go.
let ViroARScene: any = null;
let ViroAmbientLight: any = null;
let ViroDirectionalLight: any = null;
let Viro3DObject: any = null;
let ViroNode: any = null;
let ViroTrackingStateConstants: any = null;
let ViroMaterials: any = null;
let ViroARPlaneSelector: any = null;
let ViroARImageMarker: any = null;
let ViroARTrackingTargets: any = null;
let ViroText: any = null;

try {
  const viro = require('@reactvision/react-viro');
  ViroARScene = viro.ViroARScene;
  ViroAmbientLight = viro.ViroAmbientLight;
  ViroDirectionalLight = viro.ViroDirectionalLight;
  Viro3DObject = viro.Viro3DObject;
  ViroNode = viro.ViroNode;
  ViroTrackingStateConstants = viro.ViroTrackingStateConstants;
  ViroMaterials = viro.ViroMaterials;
  ViroARPlaneSelector = viro.ViroARPlaneSelector;
  ViroARImageMarker = viro.ViroARImageMarker;
  ViroARTrackingTargets = viro.ViroARTrackingTargets;
  ViroText = viro.ViroText;
} catch {
  // Viro not available — host screen shows a fallback instead.
}

try {
  ViroMaterials?.createMaterials?.({
    ghostOverlay: {
      diffuseColor: '#00FF0022',
      lightingModel: 'Constant',
      blendMode: 'Alpha',
    },
  });
} catch {
  // ignore
}

try {
  ViroARTrackingTargets?.createTargets?.({
    reference: {
      source: require('../../../../assets/icon.png'),
      orientation: 'Up',
      physicalWidth: 0.1,
    },
  });
} catch {
  // ignore
}

interface SceneProps {
  sceneNavigator: {
    viroAppProps: {
      modelUri: string;
      wireframeUri: string | null;
      renderMode: RenderMode;
      trackingMode: TrackingMode;
      placed: boolean;
      position: Vec3;
      scale: Vec3;
      rotation: Vec3;
      locked: boolean;
      dimensions: ModelDimensions | null;
      measurements: MeasurementState;
      qualityEntries?: ARQualityEntry[];
      onPlace: (position: Vec3) => void;
      onPinch: (pinchState: number, scaleFactor: number) => void;
      onRotate: (rotateState: number, rotationFactor: number) => void;
      onModelStatus: (status: string) => void;
      onTrackingUpdated?: (state: string) => void;
      onAddModelRulerPoint: (p: Vec3) => void;
      onAddRealRulerPoint: (p: Vec3) => void;
    };
  };
}

function ARModelScene(props: SceneProps) {
  const {
    modelUri,
    wireframeUri,
    renderMode,
    trackingMode,
    placed,
    position,
    scale,
    rotation,
    locked,
    dimensions,
    measurements,
    qualityEntries,
    onPlace,
    onPinch,
    onRotate,
    onModelStatus,
    onTrackingUpdated,
    onAddModelRulerPoint,
    onAddRealRulerPoint,
  } = props.sceneNavigator.viroAppProps;

  const [imageMarkerFound, setImageMarkerFound] = useState(false);
  const placingRef = useRef(false);
  const sceneRef = useRef<any>(null);

  const rulerActive =
    measurements.modelRulerActive || measurements.realRulerActive;

  const placeInFrontOfCamera = (fallback: number[]) => {
    const scene = sceneRef.current;
    const finish = (pos: Vec3) => {
      onPlace(pos);
      setTimeout(() => {
        placingRef.current = false;
      }, 300);
    };
    if (scene?.getCameraOrientationAsync) {
      scene
        .getCameraOrientationAsync()
        .then((cam: any) => {
          const [px, py, pz] = cam.position;
          const [fx, fy, fz] = cam.forward;
          const d = 1.5;
          finish([px + fx * d, py + fy * d, pz + fz * d]);
        })
        .catch(() => finish([fallback[0], fallback[1], fallback[2]]));
    } else {
      finish([fallback[0], fallback[1], fallback[2]]);
    }
  };

  const handleSceneTap = (tapPosition: number[]) => {
    // Real-world ruler consumes taps anywhere
    if (measurements.realRulerActive && placed) {
      onAddRealRulerPoint([tapPosition[0], tapPosition[1], tapPosition[2]]);
      return;
    }
    // Placement (world mode only) when not yet placed
    if (trackingMode !== 'world') return;
    if (placed || placingRef.current) return;
    placingRef.current = true;
    placeInFrontOfCamera(tapPosition);
  };

  const handleModelTap = (tapPosition: number[]) => {
    if (measurements.modelRulerActive && placed) {
      onAddModelRulerPoint([tapPosition[0], tapPosition[1], tapPosition[2]]);
    }
  };

  const handlePinch = (pinchState: number, scaleFactor: number) => {
    if (!locked && !rulerActive) onPinch(pinchState, scaleFactor);
  };

  const handleRotate = (rotateState: number, rotationFactor: number) => {
    if (!locked && !rulerActive) onRotate(rotateState, rotationFactor);
  };

  const handleTrackingUpdated = (state: any) => {
    if (state === ViroTrackingStateConstants?.TRACKING_NORMAL) {
      onTrackingUpdated?.('normal');
    } else if (state === ViroTrackingStateConstants?.TRACKING_LIMITED) {
      onTrackingUpdated?.('limited');
    } else if (state === ViroTrackingStateConstants?.TRACKING_UNAVAILABLE) {
      onTrackingUpdated?.('unavailable');
    }
  };

  const modelGestureProps =
    locked || rulerActive ? {} : { onPinch: handlePinch, onRotate: handleRotate };

  const modelObjectProps = {
    position: [0, 0, 0] as Vec3,
    onClick: handleModelTap,
    onLoadStart: () => onModelStatus('loading'),
    onLoadEnd: () => onModelStatus('loaded'),
    onError: (event: any) => {
      if (__DEV__) console.warn('Model load error:', event?.nativeEvent);
      onModelStatus('error: ' + (event?.nativeEvent?.error || 'unknown'));
    },
  };

  const renderModelObject = () => {
    if (renderMode === 'wireframe' && wireframeUri) {
      return (
        <Viro3DObject
          source={{ uri: wireframeUri }}
          type="GLB"
          {...modelObjectProps}
        />
      );
    }
    if (renderMode === 'ghost') {
      return (
        <Viro3DObject
          source={{ uri: modelUri }}
          type="GLB"
          materials={['ghostOverlay']}
          {...modelObjectProps}
        />
      );
    }
    return (
      <Viro3DObject
        source={{ uri: modelUri }}
        type="GLB"
        {...modelObjectProps}
      />
    );
  };

  // modelNode wraps the model + dimension overlays with the same transform,
  // so labels align with the model in every mode.
  const modelNode = (
    <ViroNode
      position={position}
      scale={scale}
      rotation={rotation}
      {...modelGestureProps}
    >
      {renderModelObject()}
      {measurements.showOverall && dimensions && (
        <OverallDimensionsOverlay dimensions={dimensions} />
      )}
      {measurements.showParts && dimensions && (
        <PartDimensionsOverlay dimensions={dimensions} />
      )}
      {qualityEntries && qualityEntries.length > 0 && (
        <QualityStatusOverlay entries={qualityEntries} dimensions={dimensions} />
      )}
    </ViroNode>
  );

  // Ruler markers live at scene root in world space. Requires the model to
  // be locked for the model-ruler readings to stay meaningful across moves.
  const rulerOverlays = (
    <>
      {measurements.modelRulerPoints.length > 0 && (
        <RulerOverlay
          points={measurements.modelRulerPoints}
          colorKey="green"
        />
      )}
      {measurements.realRulerPoints.length > 0 && (
        <RulerOverlay points={measurements.realRulerPoints} colorKey="blue" />
      )}
    </>
  );

  const hintText = (text: string) =>
    ViroText ? (
      <ViroText
        text={text}
        position={[0, 0, -1]}
        style={{
          fontFamily: 'Arial',
          fontSize: 18,
          color: '#ffffff',
          textAlign: 'center',
        }}
        width={2}
        height={0.4}
      />
    ) : null;

  const lights = (
    <>
      <ViroAmbientLight color="#ffffff" intensity={300} />
      <ViroDirectionalLight
        color="#ffffff"
        direction={[0, -1, -0.5]}
        castsShadow={true}
        shadowOpacity={0.4}
      />
      <ViroDirectionalLight
        color="#ffffff"
        direction={[0, 0.5, -1]}
        intensity={100}
      />
    </>
  );

  if (trackingMode === 'plane' && ViroARPlaneSelector) {
    return (
      <ViroARScene
        onTrackingUpdated={handleTrackingUpdated}
        onClick={handleSceneTap}
      >
        {lights}
        <ViroARPlaneSelector
          minHeight={0.1}
          minWidth={0.1}
          alignment="Horizontal"
          onPlaneSelected={() => {
            if (!placed) onPlace([0, 0, 0]);
          }}
        >
          {modelNode}
        </ViroARPlaneSelector>
        {rulerOverlays}
        {!placed && hintText('Move phone to detect a surface, then tap it')}
      </ViroARScene>
    );
  }

  if (trackingMode === 'image' && ViroARImageMarker) {
    return (
      <ViroARScene
        onTrackingUpdated={handleTrackingUpdated}
        onClick={handleSceneTap}
      >
        {lights}
        <ViroARImageMarker
          target="reference"
          onAnchorFound={() => {
            setImageMarkerFound(true);
            if (!placed) onPlace([0, 0, 0]);
          }}
          onAnchorRemoved={() => setImageMarkerFound(false)}
        >
          {modelNode}
        </ViroARImageMarker>
        {rulerOverlays}
        {!imageMarkerFound && hintText('Point camera at reference image')}
      </ViroARScene>
    );
  }

  // world mode (default): drift-prone free placement via scene taps.
  return (
    <ViroARScene
      ref={sceneRef}
      onTrackingUpdated={handleTrackingUpdated}
      onClick={handleSceneTap}
    >
      {lights}
      {placed && modelNode}
      {rulerOverlays}
      {!placed && hintText('Tap anywhere to place the model')}
    </ViroARScene>
  );
}

export default ARModelScene;