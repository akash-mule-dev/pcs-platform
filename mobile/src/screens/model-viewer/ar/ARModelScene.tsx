// Ported from glb-viewer, adapted for PCS: Viro components are lazy-`require`d
// (not statically imported) and material/target registration is guarded so the
// module is safe to import in Expo Go / Jest. Logic is otherwise unchanged:
// solid / ghost / wireframe render modes, world / plane / image tracking,
// model + real-world rulers, and dimension overlays.
import React, { useRef } from 'react';
import { Vec3, RenderMode, TrackingMode, MeasurementState } from './types';
import { ModelDimensions } from './dimensionExtractor';
import {
  OverallDimensionsOverlay,
  PartDimensionsOverlay,
  RulerOverlay,
} from './MeasurementOverlays';
import { QualityStatusOverlay } from './QualityStatusOverlay';
import { QaPartsOverlay } from './QaPartsOverlay';
import { ARQualityEntry } from './useQualityData';

// Lazy-load Viro — static imports crash in Expo Go.
let ViroARScene: any = null;
let ViroAmbientLight: any = null;
let ViroDirectionalLight: any = null;
let Viro3DObject: any = null;
let ViroNode: any = null;
let ViroTrackingStateConstants: any = null;
let ViroMaterials: any = null;
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
    // IFC-converted GLBs carry NO materials and NO vertex normals (same reason
    // the web 3D viewer has to assign a material + computeVertexNormals), so the
    // Viro default renders the model invisible. 'Constant' lighting shows the
    // diffuseColor without needing normals, guaranteeing the part is visible in AR.
    steelSolid: {
      diffuseColor: '#9aa2ad',
      lightingModel: 'Constant',
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
      // Deviation probe (optional): pair a model point with a real point.
      onAddDeviationModelPoint?: (p: Vec3) => void;
      onAddDeviationRealPoint?: (p: Vec3) => void;
      // Per-part QA overlay (optional): heat-map / focus / tap-to-inspect.
      qaOverlayVisible?: boolean;
      qaSelectable?: boolean;
      focusMeshName?: string | null;
      onPartTap?: (meshName: string) => void;
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
    onAddDeviationModelPoint,
    onAddDeviationRealPoint,
    qaOverlayVisible,
    qaSelectable,
    focusMeshName,
    onPartTap,
  } = props.sceneNavigator.viroAppProps;

  const placingRef = useRef(false);
  const sceneRef = useRef<any>(null);
  const viro3dRef = useRef<any>(null); // solid model node — used to read its bbox on load (diagnostics)

  const rulerActive =
    measurements.modelRulerActive ||
    measurements.realRulerActive ||
    !!measurements.deviationActive;

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
    const p: Vec3 = [tapPosition[0], tapPosition[1], tapPosition[2]];
    // Deviation probe: once the model point is set, the next scene tap is the
    // matching point on the real surface.
    if (
      measurements.deviationActive &&
      placed &&
      measurements.deviationModelPoint &&
      !measurements.deviationRealPoint
    ) {
      onAddDeviationRealPoint?.(p);
      return;
    }
    // Real-world ruler consumes taps anywhere
    if (measurements.realRulerActive && placed) {
      onAddRealRulerPoint(p);
      return;
    }
    // Placement — IDENTICAL in all three modes: a single tap drops the model in
    // front of the camera. The tracking mode only changes how ARKit stabilizes
    // the world (anchorDetectionTypes below + worldAlignment on the navigator),
    // never how the model is placed, so the flow is the same everywhere.
    if (placed || placingRef.current) return;
    placingRef.current = true;
    placeInFrontOfCamera(p);
  };

  const handleModelTap = (tapPosition: number[]) => {
    const p: Vec3 = [tapPosition[0], tapPosition[1], tapPosition[2]];
    // Deviation probe: the first tap lands on the virtual model.
    if (measurements.deviationActive && placed && !measurements.deviationModelPoint) {
      onAddDeviationModelPoint?.(p);
      return;
    }
    if (measurements.modelRulerActive && placed) {
      onAddModelRulerPoint(p);
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
    onLoadEnd: async () => {
      // Report the loaded model's world-space size so we can tell a load success
      // from a scale problem (dims here = raw GLB size × the node scale 0.2).
      try {
        const r = await viro3dRef.current?.getBoundingBoxAsync?.();
        const b = r?.boundingBox ?? r;
        if (b && typeof b.maxX === 'number') {
          const sz = [b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ]
            .map((n: number) => Number(n).toFixed(2))
            .join('×');
          onModelStatus('loaded ' + sz + 'm');
          return;
        }
      } catch {
        /* ignore */
      }
      onModelStatus('loaded');
    },
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
        ref={viro3dRef}
        source={{ uri: modelUri }}
        type="GLB"
        materials={['steelSolid']}
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
      {qaOverlayVisible && (
        <QaPartsOverlay
          dimensions={dimensions}
          entries={qualityEntries}
          selectable={qaSelectable}
          onPartTap={onPartTap}
          focusMeshName={focusMeshName}
        />
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
      {measurements.deviationModelPoint && measurements.deviationRealPoint && (
        <RulerOverlay
          points={[measurements.deviationModelPoint, measurements.deviationRealPoint]}
          colorKey="green"
        />
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

  // All three modes share ONE scene and ONE placement flow: a single tap drops
  // the model in front of the camera (see handleSceneTap), shown only once
  // placed. The mode is purely a live tracking PRESET on this never-swapped
  // scene — no ViroARPlaneSelector / ViroARImageMarker structural swap, which is
  // what made the old per-mode flows diverge and made switching unreliable.
  // 'plane'/'image' turn on ARKit plane detection for steadier tracking;
  // worldAlignment (set on the navigator) further differentiates the presets.
  const anchorDetectionTypes =
    trackingMode === 'world' ? ['None'] : ['PlanesHorizontal', 'PlanesVertical'];

  return (
    <ViroARScene
      ref={sceneRef}
      anchorDetectionTypes={anchorDetectionTypes as any}
      onTrackingUpdated={handleTrackingUpdated}
      onClick={handleSceneTap}
    >
      {lights}
      {placed && modelNode}
      {rulerOverlays}
      {!placed && hintText('Tap to place the model')}
    </ViroARScene>
  );
}

export default ARModelScene;