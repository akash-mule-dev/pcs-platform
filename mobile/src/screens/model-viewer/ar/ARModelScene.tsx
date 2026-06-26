// The live AR scene. Camera-first by construction: the scene (and therefore the
// real camera feed) renders the instant the navigator mounts — it never waits on
// the model. The model streams in via the `modelUri` prop and, once loaded:
//   1. auto-places ~1.5 m in front of the camera (no tap required),
//   2. auto-fits its scale from its own bounding box (so a beam stored in mm and
//      a part stored in m both arrive at a sensible ~0.6 m viewing size), then
//   3. fades in — kept invisible until fit so there's no wrong-size "pop".
// Viro is lazy-`require`d and all native registration is guarded, so importing
// this module is safe in Expo Go / Jest where the native module is absent.
import React, { useEffect, useRef, useState } from 'react';
import { Vec3, RenderMode, TrackingMode, MeasurementState, EDGE_COLORS, DEFAULT_EDGE_COLOR } from './types';
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
let ViroARPlane: any = null;
let ViroTrackingStateConstants: any = null;
let ViroMaterials: any = null;

try {
  const viro = require('@reactvision/react-viro');
  ViroARScene = viro.ViroARScene;
  ViroAmbientLight = viro.ViroAmbientLight;
  ViroDirectionalLight = viro.ViroDirectionalLight;
  Viro3DObject = viro.Viro3DObject;
  ViroNode = viro.ViroNode;
  // ViroARPlane: a container whose world transform is driven by an ARKit plane
  // anchor that ARKit continuously refines — the stable-anchoring primitive used
  // by the opt-in "Lock to surface" path below.
  ViroARPlane = viro.ViroARPlane;
  ViroTrackingStateConstants = viro.ViroTrackingStateConstants;
  ViroMaterials = viro.ViroMaterials;
} catch {
  // Viro not available — host screen shows a fallback instead.
}

try {
  ViroMaterials?.createMaterials?.({
    // IFC-converted GLBs carry NO materials and NO vertex normals (the same
    // reason the web 3D viewer assigns a material + computeVertexNormals), so a
    // lit material renders them invisible. 'Constant' shows the diffuseColor
    // without needing normals, guaranteeing the part is visible in AR.
    steelSolid: {
      diffuseColor: '#aab2bd',
      lightingModel: 'Constant',
    },
    // Bright unlit edges for the edge view, ONE material per selectable colour
    // (the Edges panel swatches). Constant lighting needs no normals (the edge
    // tubes carry none) and stays vivid over any real-world backdrop, so the
    // model's edges read clearly against the physical part. Colour swaps are a
    // material swap on the same GLB — instant, no regeneration.
    ...Object.fromEntries(
      EDGE_COLORS.map((c) => [c.material, { diffuseColor: c.hex, lightingModel: 'Constant' }]),
    ),
  });
} catch {
  // ignore
}

// Resolve the registered edge material key for a colour hex (falls back to the
// first/default colour for an unknown value).
function edgeMaterialFor(hex: string): string {
  return (EDGE_COLORS.find((c) => c.hex === hex) ?? EDGE_COLORS[0]).material;
}

interface SceneProps {
  sceneNavigator: {
    viroAppProps: {
      modelUri: string;
      wireframeUri: string | null;
      renderMode: RenderMode;
      /** Edge-view colour (hex) → selects the registered edge material. */
      edgeColor?: string;
      trackingMode: TrackingMode;
      placed: boolean;
      autoFitted: boolean;
      position: Vec3;
      scale: Vec3;
      rotation: Vec3;
      locked: boolean;
      dimensions: ModelDimensions | null;
      measurements: MeasurementState;
      qualityEntries?: ARQualityEntry[];
      /** Auto-place the model in front of the camera once it's ready. */
      autoPlace?: boolean;
      /** Opt-in "Lock to surface": render the model under a ViroARPlane anchor
       *  (ARKit-driven, drift-free) instead of a free world-coordinate node. */
      anchorMode?: boolean;
      /** Fired when the ViroARPlane attaches to a real ARKit plane (model is now
       *  anchored + stable). */
      onAnchorFound?: () => void;
      onPlace: (position: Vec3) => void;
      /** Report the one-shot fit scale derived from the loaded bounding box. */
      onAutoFit?: (scale: Vec3) => void;
      onPinch: (pinchState: number, scaleFactor: number) => void;
      onRotate: (rotateState: number, rotationFactor: number) => void;
      onModelStatus: (status: string) => void;
      onTrackingUpdated?: (state: string) => void;
      onAddModelRulerPoint: (p: Vec3) => void;
      onAddRealRulerPoint: (p: Vec3) => void;
      onAddDeviationModelPoint?: (p: Vec3) => void;
      onAddDeviationRealPoint?: (p: Vec3) => void;
      qaOverlayVisible?: boolean;
      qaSelectable?: boolean;
      focusMeshName?: string | null;
      onPartTap?: (meshName: string) => void;
      /** Incremented by the HUD's "Place point" button to drop a point at the
       * reticle (center of view) — far more precise than tapping a small target. */
      placeNonce?: number;
    };
  };
}

// Target viewing size for a freshly loaded model (metres, longest dimension).
const AUTOFIT_TARGET_M = 0.6;
const PLACE_DISTANCE_M = 1.5;

function ARModelScene(props: SceneProps) {
  const {
    modelUri,
    wireframeUri,
    renderMode,
    edgeColor = DEFAULT_EDGE_COLOR,
    placed,
    autoFitted,
    position,
    scale,
    rotation,
    locked,
    dimensions,
    measurements,
    qualityEntries,
    autoPlace = true,
    anchorMode = false,
    onAnchorFound,
    onPlace,
    onAutoFit,
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
    placeNonce = 0,
  } = props.sceneNavigator.viroAppProps;

  const sceneRef = useRef<any>(null);
  const modelRef = useRef<any>(null); // active model node — read its bbox on load
  const tapPlacingRef = useRef(false);
  const autoFitDoneRef = useRef(false);
  // Reticle placement: the latest real-world AR hit at the center of view, and
  // the live camera pose (for a forward-ray fallback when there's no hit yet).
  const cameraHitRef = useRef<Vec3 | null>(null);
  const cameraPoseRef = useRef<{ pos: Vec3; forward: Vec3 } | null>(null);
  const lastPlaceNonceRef = useRef(0);
  // Last-resort fit timer: if neither Viro's AR bbox NOR the JS-extracted
  // geometry size yields a scale, apply a visible default after a grace period so
  // the model is never left stuck at the microscopic provisional scale.
  const fallbackFitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fade-in is driven by a tiny JS opacity ramp rather than ViroAnimations, so a
  // missing/parse-failed animation registration can never leave the model stuck
  // invisible. The model stays at opacity 0 until it has loaded AND been fit.
  const [opacity, setOpacity] = useState(0);
  const [modelReady, setModelReady] = useState(false);
  const fadeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const rulerActive =
    measurements.modelRulerActive ||
    measurements.realRulerActive ||
    !!measurements.deviationActive;

  // ── Reset per-model load state when the model changes ──
  useEffect(() => {
    autoFitDoneRef.current = false;
    tapPlacingRef.current = false;
    setModelReady(false);
    setOpacity(0);
    if (fadeTimerRef.current) {
      clearInterval(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
    if (fallbackFitTimerRef.current) {
      clearTimeout(fallbackFitTimerRef.current);
      fallbackFitTimerRef.current = null;
    }
  }, [modelUri]);

  // ── Geometry-based auto-fit (the no-depth-sensor path) ──
  // On a LiDAR device Viro's bounding box is real and handleLoadEnd fits from it.
  // On a device WITHOUT a depth sensor that box comes back empty (0×0×0), so we
  // instead fit from the GLB's real geometry size — extracted in JS off-device,
  // so it's reliable everywhere — the moment it's available. This sizes the part
  // to ~AUTOFIT_TARGET_M (visible) and lets the HUD show a true on-screen size
  // instead of 0.00×0.00×0.00m. Strictly one-shot (guarded by autoFitDoneRef and
  // the reducer's autoFitted flag), and it cancels the last-resort timer.
  useEffect(() => {
    if (autoFitted || autoFitDoneRef.current || !modelReady || !dimensions) return;
    const sz = dimensions.overall.size;
    const rawLongest = Math.max(sz[0], sz[1], sz[2]);
    if (!(rawLongest > 0) || !isFinite(rawLongest)) return;
    autoFitDoneRef.current = true;
    if (fallbackFitTimerRef.current) {
      clearTimeout(fallbackFitTimerRef.current);
      fallbackFitTimerRef.current = null;
    }
    let fit = AUTOFIT_TARGET_M / rawLongest;
    fit = Math.max(0.001, Math.min(8, fit));
    onAutoFit?.([fit, fit, fit]);
    onModelStatus(
      'loaded ' + [sz[0], sz[1], sz[2]].map((n) => (n * fit).toFixed(2)).join('×') + 'm',
    );
  }, [modelReady, dimensions, autoFitted, onAutoFit, onModelStatus]);

  // ── Fade in once the model has loaded + been fit ──
  useEffect(() => {
    if (!modelReady) return;
    if (fadeTimerRef.current) clearInterval(fadeTimerRef.current);
    let o = 0;
    fadeTimerRef.current = setInterval(() => {
      o = Math.min(1, o + 0.12);
      setOpacity(o);
      if (o >= 1 && fadeTimerRef.current) {
        clearInterval(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
    }, 40);
    return () => {
      if (fadeTimerRef.current) {
        clearInterval(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
    };
  }, [modelReady]);

  // ── Auto-place in front of the camera the moment the model is ready ──
  // Re-runs if placement is dropped (e.g. a tracking-mode switch sets placed=false).
  const inFlightRef = useRef(false);
  useEffect(() => {
    // Anchor mode owns placement (the model rides a ViroARPlane), so the
    // free-coordinate auto-place must not run alongside it.
    if (!modelUri || !autoPlace || placed || anchorMode) {
      inFlightRef.current = false;
      return;
    }
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    let cancelled = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (pos: Vec3) => {
      if (!cancelled) onPlace(pos);
    };
    const scheduleRetry = () => {
      if (cancelled) return;
      if (tries++ < 10) timer = setTimeout(attempt, 300);
      else finish([0, -0.2, -PLACE_DISTANCE_M]); // fallback: straight ahead
    };
    const attempt = () => {
      if (cancelled) return;
      const scene = sceneRef.current;
      const getCam = scene?.getCameraOrientationAsync;
      if (typeof getCam === 'function') {
        getCam
          .call(scene)
          .then((cam: any) => {
            if (cancelled) return;
            const p = cam?.position;
            const f = cam?.forward;
            if (Array.isArray(p) && Array.isArray(f)) {
              const d = PLACE_DISTANCE_M;
              finish([p[0] + f[0] * d, p[1] + f[1] * d, p[2] + f[2] * d]);
            } else {
              scheduleRetry();
            }
          })
          .catch(scheduleRetry);
      } else {
        scheduleRetry();
      }
    };
    // Small warm-up delay so the AR session has a camera pose to report.
    timer = setTimeout(attempt, 250);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [modelUri, autoPlace, placed, anchorMode, onPlace]);

  // Manual tap-to-place fallback (if auto-place is slow) + measurement taps.
  const placeInFrontOfCamera = (fallback: number[]) => {
    const scene = sceneRef.current;
    const finish = (pos: Vec3) => {
      onPlace(pos);
      setTimeout(() => {
        tapPlacingRef.current = false;
      }, 300);
    };
    if (scene?.getCameraOrientationAsync) {
      scene
        .getCameraOrientationAsync()
        .then((cam: any) => {
          const [px, py, pz] = cam.position;
          const [fx, fy, fz] = cam.forward;
          const d = PLACE_DISTANCE_M;
          finish([px + fx * d, py + fy * d, pz + fz * d]);
        })
        .catch(() => finish([fallback[0], fallback[1], fallback[2]]));
    } else {
      finish([fallback[0], fallback[1], fallback[2]]);
    }
  };

  const handleSceneTap = (tapPosition: number[]) => {
    const p: Vec3 = [tapPosition[0], tapPosition[1], tapPosition[2]];
    if (
      measurements.deviationActive &&
      placed &&
      measurements.deviationModelPoint &&
      !measurements.deviationRealPoint
    ) {
      onAddDeviationRealPoint?.(p);
      return;
    }
    if (measurements.realRulerActive && placed) {
      onAddRealRulerPoint(p);
      return;
    }
    if (placed || tapPlacingRef.current) return;
    tapPlacingRef.current = true;
    placeInFrontOfCamera(p);
  };

  const handleModelTap = (tapPosition: number[]) => {
    const p: Vec3 = [tapPosition[0], tapPosition[1], tapPosition[2]];
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

  // ── Reticle hit-testing (fires every frame while a ruler tool is active) ──
  // Store the closest real-world hit at the center of view + the live camera
  // pose in refs (no setState → no per-frame re-render); the "Place point" button
  // reads these to drop a precise point under the reticle.
  const handleCameraARHitTest = (event: any) => {
    const results = event?.hitTestResults ?? event?.nativeEvent?.hitTestResults;
    if (!Array.isArray(results) || results.length === 0) {
      cameraHitRef.current = null;
      return;
    }
    // Prefer a hit on a detected plane, else the closest result with a position.
    const onPlane = results.find(
      (r: any) => typeof r?.type === 'string' && r.type.toLowerCase().includes('plane'),
    );
    const best = onPlane ?? results.find((r: any) => r?.transform?.position ?? r?.position) ?? results[0];
    const pos = best?.transform?.position ?? best?.position;
    cameraHitRef.current =
      Array.isArray(pos) && pos.length >= 3 ? [pos[0], pos[1], pos[2]] : null;
  };

  const handleCameraTransformUpdate = (t: any) => {
    const pos = t?.position ?? t?.cameraTransform?.position;
    const fwd = t?.forward ?? t?.cameraTransform?.forward;
    if (Array.isArray(pos) && Array.isArray(fwd)) {
      cameraPoseRef.current = {
        pos: [pos[0], pos[1], pos[2]],
        forward: [fwd[0], fwd[1], fwd[2]],
      };
    }
  };

  // ── "Place point" → drop a REAL-world point at the reticle ──
  // Model points are placed by tapping the model directly (surface-accurate);
  // real-world points (real ruler / deviation real point) are placed here at the
  // center-of-view AR hit, or a forward-ray fallback if no hit is available.
  useEffect(() => {
    if (!placeNonce || placeNonce === lastPlaceNonceRef.current) return;
    lastPlaceNonceRef.current = placeNonce;
    const needRealForDeviation =
      measurements.deviationActive &&
      !!measurements.deviationModelPoint &&
      !measurements.deviationRealPoint;
    const realStep = measurements.realRulerActive || needRealForDeviation;
    if (!realStep || !placed) return;

    const add = (p: Vec3) => {
      if (needRealForDeviation) onAddDeviationRealPoint?.(p);
      else onAddRealRulerPoint(p);
    };
    const forwardFrom = (pos: number[], fwd: number[], d = 1.2): Vec3 => [
      pos[0] + fwd[0] * d,
      pos[1] + fwd[1] * d,
      pos[2] + fwd[2] * d,
    ];

    // Best: the real AR hit under the reticle. Next: a forward-ray from the live
    // camera pose. Last resort (refs not populated yet, e.g. just entered the
    // step in world mode): query the camera orientation so the press is never a
    // silent no-op.
    if (cameraHitRef.current) {
      add(cameraHitRef.current);
      return;
    }
    const c = cameraPoseRef.current;
    if (c) {
      add(forwardFrom(c.pos, c.forward));
      return;
    }
    const scene = sceneRef.current;
    if (scene?.getCameraOrientationAsync) {
      scene
        .getCameraOrientationAsync()
        .then((cam: any) => {
          if (Array.isArray(cam?.position) && Array.isArray(cam?.forward)) {
            add(forwardFrom(cam.position, cam.forward));
          }
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeNonce]);

  // Read the loaded model's world-space bbox → derive a one-shot fit scale and
  // reveal it. Distinguishes a load success from a scale/visibility problem.
  //
  // On a LiDAR device Viro returns a real box and we fit from it here. On a device
  // WITHOUT a depth sensor it returns an empty (0×0×0) box — so we deliberately do
  // NOT guess a fixed scale here (the old [0.2,0.2,0.2] fallback fired immediately
  // and PERMANENTLY locked the one-shot APPLY_AUTOFIT, leaving every part stuck at
  // a wrong size). Instead the geometry-based effect above fits from the GLB's
  // real size as soon as it's extracted; a short timer applies a visible default
  // only if that extraction never produces a size.
  const handleLoadEnd = async () => {
    let measured = false;
    let sizeLabel = '';
    try {
      const r = await modelRef.current?.getBoundingBoxAsync?.();
      const b = r?.boundingBox ?? r;
      if (b && typeof b.maxX === 'number') {
        const dx = b.maxX - b.minX;
        const dy = b.maxY - b.minY;
        const dz = b.maxZ - b.minZ;
        const longest = Math.max(dx, dy, dz);
        if (longest > 0 && isFinite(longest)) {
          measured = true;
          sizeLabel = [dx, dy, dz].map((n: number) => Number(n).toFixed(2)).join('×') + 'm';
          if (!autoFitted && !autoFitDoneRef.current) {
            autoFitDoneRef.current = true;
            const current = scale[0] || 0.05;
            const rawLongest = longest / current; // longest dimension at scale 1
            let fit = AUTOFIT_TARGET_M / rawLongest;
            fit = Math.max(0.001, Math.min(8, fit));
            onAutoFit?.([fit, fit, fit]);
          }
        }
      }
    } catch {
      /* bbox read unsupported on this device — fall through to the geometry fit */
    }
    if (!measured && !autoFitted && !autoFitDoneRef.current) {
      // No usable AR bbox. The geometry-based effect will fit once dimensions are
      // ready; if extraction never yields a size, apply a visible default so the
      // model is never stuck microscopic. (Does not run if the effect fits first
      // — both guard on autoFitDoneRef.)
      if (fallbackFitTimerRef.current) clearTimeout(fallbackFitTimerRef.current);
      fallbackFitTimerRef.current = setTimeout(() => {
        if (!autoFitDoneRef.current) {
          autoFitDoneRef.current = true;
          onAutoFit?.([0.2, 0.2, 0.2]);
        }
      }, 4000);
    }
    onModelStatus(sizeLabel ? 'loaded ' + sizeLabel : 'loaded');
    setModelReady(true); // triggers the fade-in (and the geometry-fit effect)
  };

  const modelObjectProps = {
    position: [0, 0, 0] as Vec3,
    onClick: handleModelTap,
    onLoadStart: () => onModelStatus('loading'),
    onLoadEnd: handleLoadEnd,
    onError: (event: any) => {
      if (__DEV__) console.warn('Model load error:', event?.nativeEvent);
      onModelStatus('error: ' + (event?.nativeEvent?.error || 'unknown'));
      // Reveal anyway so a partial/odd model isn't silently invisible.
      setModelReady(true);
    },
  };

  const renderModelObject = () => {
    if (renderMode === 'wireframe' && wireframeUri) {
      // Each colour/weight is a distinct GLB (baked + per-combo URI); the key on
      // the URI remounts on a change, and Viro applies the matching Constant
      // material on the fresh load. (The wireframe GLB is small + local, so the
      // reload is quick.)
      return (
        <Viro3DObject
          key={wireframeUri}
          ref={modelRef}
          source={{ uri: wireframeUri }}
          type="GLB"
          materials={[edgeMaterialFor(edgeColor)]}
          {...modelObjectProps}
        />
      );
    }
    return (
      <Viro3DObject
        ref={modelRef}
        source={{ uri: modelUri }}
        type="GLB"
        materials={['steelSolid']}
        {...modelObjectProps}
      />
    );
  };

  const modelGestureProps =
    locked || rulerActive ? {} : { onPinch: handlePinch, onRotate: handleRotate };

  // Transform node carries placement; an inner node carries the fade opacity so
  // the model can be hidden-until-fit without disturbing overlay positioning.
  const modelNode = (
    <ViroNode position={position} scale={scale} rotation={rotation} {...modelGestureProps}>
      <ViroNode opacity={opacity}>{renderModelObject()}</ViroNode>
      {measurements.showOverall && dimensions && (
        <OverallDimensionsOverlay
          dimensions={dimensions}
          modelScale={scale[0]}
          labelSize={measurements.labelSize}
        />
      )}
      {measurements.showParts && dimensions && (
        <PartDimensionsOverlay
          dimensions={dimensions}
          modelScale={scale[0]}
          labelSize={measurements.labelSize}
        />
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

  // Opt-in "Lock to surface": the SAME model node, parented under a ViroARPlane
  // so ARKit owns and continuously refines its world transform — which removes
  // the free-coordinate drift/jitter. The plane auto-attaches to a detected
  // horizontal surface; once it does, onAnchorFound fires (the lock is engaged)
  // and the model becomes visible riding the anchor. Here `position` is a LOCAL
  // offset from the plane centre (reset to origin when the lock is engaged, then
  // nudged via the Align panel to line up with the real part). Falls back to
  // nothing if ViroARPlane is unavailable (e.g. the Jest mock) — the host shows
  // a hint to point at a surface, and Unlock returns to free placement.
  const anchoredModelNode = ViroARPlane ? (
    <ViroARPlane
      alignment="Horizontal"
      minWidth={0.3}
      minHeight={0.3}
      onAnchorFound={() => onAnchorFound?.()}
    >
      {modelNode}
    </ViroARPlane>
  ) : null;

  // Ruler markers live at scene root in world space.
  const rulerOverlays = (
    <>
      {measurements.modelRulerPoints.length > 0 && (
        <RulerOverlay
          points={measurements.modelRulerPoints}
          colorKey="green"
          labelSize={measurements.labelSize}
          scaleDivisor={scale[0]}
        />
      )}
      {measurements.realRulerPoints.length > 0 && (
        <RulerOverlay
          points={measurements.realRulerPoints}
          colorKey="blue"
          labelSize={measurements.labelSize}
        />
      )}
      {measurements.deviationModelPoint && measurements.deviationRealPoint && (
        <RulerOverlay
          points={[measurements.deviationModelPoint, measurements.deviationRealPoint]}
          colorKey="green"
          labelSize={measurements.labelSize}
        />
      )}
    </>
  );

  const lights = (
    <>
      <ViroAmbientLight color="#ffffff" intensity={320} />
      <ViroDirectionalLight color="#ffffff" direction={[0, -1, -0.5]} intensity={420} />
      <ViroDirectionalLight color="#dfe6f2" direction={[0.3, 0.4, -1]} intensity={140} />
    </>
  );

  // Plane detection is ALWAYS on, in every mode. It gives ARKit far more
  // environmental structure to lock onto, which steadies the placed model even
  // though it isn't (yet) explicitly anchored to a plane — and on LiDAR devices
  // ARKit uses the depth sensor to find planes, so this is what actually puts
  // the LiDAR to work. (Previously 'world' mode set ['None'] — the least-stable
  // configuration, and the reason world mode drifted the most.)
  const anchorDetectionTypes = ['PlanesHorizontal', 'PlanesVertical'];

  return (
    <ViroARScene
      ref={sceneRef}
      anchorDetectionTypes={anchorDetectionTypes as any}
      onTrackingUpdated={handleTrackingUpdated}
      onClick={handleSceneTap}
      // Center-of-view hit testing + camera pose feed the "Place point" reticle.
      // Only enabled while measuring so it costs nothing the rest of the time.
      onCameraARHitTest={rulerActive ? handleCameraARHitTest : undefined}
      onCameraTransformUpdate={rulerActive ? handleCameraTransformUpdate : undefined}
    >
      {lights}
      {anchorMode ? anchoredModelNode : placed && modelNode}
      {rulerOverlays}
    </ViroARScene>
  );
}

export default ARModelScene;
