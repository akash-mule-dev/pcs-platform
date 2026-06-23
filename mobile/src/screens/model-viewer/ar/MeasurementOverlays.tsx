// 3D measurement overlays for the AR scene. Viro is lazy-`require`d (not a static
// import) and material registration is guarded, so importing this module never
// crashes in Expo Go / Jest where the native Viro module is unavailable.
//
// Label legibility (the AR labels were blurry/tiny before):
//   • high fontSize → crisp rasterisation (low fontSize upscaled = blur),
//   • a black outerStroke → readable over any real-world backdrop,
//   • billboard → labels always face the camera (flat quads were unreadable at
//     an angle),
//   • the dimension labels are wrapped in a node whose scale COUNTER-acts the
//     model's autofit scale, so they read at a stable on-screen size regardless
//     of the model, tunable with the Measure panel's Size slider.
import React from 'react';
import { Vec3 } from './types';
import { ModelDimensions, formatMeters } from './dimensionExtractor';

// Lazy-load Viro — static imports crash in Expo Go.
let ViroText: any = null;
let ViroSphere: any = null;
let ViroPolyline: any = null;
let ViroMaterials: any = null;
let ViroNode: any = null;

try {
  const viro = require('@reactvision/react-viro');
  ViroText = viro.ViroText;
  ViroSphere = viro.ViroSphere;
  ViroPolyline = viro.ViroPolyline;
  ViroMaterials = viro.ViroMaterials;
  ViroNode = viro.ViroNode;
} catch {
  // Viro not available — overlays simply render nothing.
}

// Register materials once, keyed by color. Guarded: the native call is a no-op
// (and must not throw) when Viro is missing.
try {
  ViroMaterials?.createMaterials?.({
    rulerGreen: { diffuseColor: '#10b981', lightingModel: 'Constant' },
    rulerBlue: { diffuseColor: '#3b82f6', lightingModel: 'Constant' },
    rulerLineGreen: { diffuseColor: '#10b981', lightingModel: 'Constant' },
    rulerLineBlue: { diffuseColor: '#3b82f6', lightingModel: 'Constant' },
    // Dimension leader lines: depth-independent so they're never hidden behind
    // the model (readsFromDepthBuffer:false → always drawn on top).
    dimLeader: {
      diffuseColor: '#e2e8f0',
      lightingModel: 'Constant',
      readsFromDepthBuffer: false,
      writesToDepthBuffer: false,
    },
  });
} catch {
  // ignore
}

const LABEL_STYLE = {
  fontFamily: 'Helvetica',
  fontSize: 48, // high → crisp; the wrapper node controls on-screen size
  color: '#ffffff',
  textAlign: 'center' as const,
  textAlignVertical: 'center' as const,
};

const LABEL_STROKE = { type: 'Outline' as const, width: 2, color: '#000000' };

// Tuned so a default (labelSize = 1) label reads at roughly the old size but
// crisp; it's scale-independent (k divides out the model scale) so the slider's
// effect is predictable, and the slider multiplies it.
const LABEL_BASE_K = 0.17;

// One billboarded, outlined text label at `position`, sized by wrapper scale `k`.
// A high renderingOrder draws it after the model so it sorts on top.
function Label3D({
  text,
  position,
  k,
  renderingOrder = 10,
}: {
  text: string;
  position: Vec3;
  k: number;
  renderingOrder?: number;
}) {
  if (!ViroNode || !ViroText) return null;
  return (
    <ViroNode
      position={position}
      scale={[k, k, k]}
      transformBehaviors={['billboard']}
      renderingOrder={renderingOrder}
    >
      <ViroText
        text={text}
        style={LABEL_STYLE}
        width={4}
        height={1}
        extrusionDepth={0}
        textClipMode="None"
        outerStroke={LABEL_STROKE}
      />
    </ViroNode>
  );
}

// A short leader line from a box face out to its label (the "referenced" look).
// Uses the depth-independent dimLeader material so it's never occluded.
function DimLeader({ from, to, thickness }: { from: Vec3; to: Vec3; thickness: number }) {
  if (!ViroPolyline) return null;
  return (
    <ViroPolyline
      points={[from, to]}
      thickness={thickness}
      materials={['dimLeader']}
      renderingOrder={9}
    />
  );
}

// ------- Overall W × H × D -------

interface OverallProps {
  dimensions: ModelDimensions;
  /** The model node's autofit scale; labels counter-scale by it. */
  modelScale?: number;
  /** Size multiplier from the Measure panel's Size slider. */
  labelSize?: number;
}

export function OverallDimensionsOverlay({
  dimensions,
  modelScale = 1,
  labelSize = 1,
}: OverallProps) {
  if (!ViroNode || !ViroText) return null;
  const { min, max, size, center } = dimensions.overall;
  const s = modelScale > 0 ? modelScale : 1;
  const k = (LABEL_BASE_K * labelSize) / s;
  const longest = Math.max(size[0], size[1], size[2]) || 1;
  const m = longest * 0.2; // how far OUTSIDE the box each label floats
  const thick = longest * 0.006;

  // Each dimension on a DISTINCT side, clear of the box (W below, H right, D
  // front), each with a short leader from the face centre out to the label — so
  // labels never sit on/inside the model and don't overlap each other.
  const dims: { text: string; face: Vec3; label: Vec3 }[] = [
    { text: `W ${formatMeters(size[0])}`, face: [center[0], min[1], center[2]], label: [center[0], min[1] - m, center[2]] },
    { text: `H ${formatMeters(size[1])}`, face: [max[0], center[1], center[2]], label: [max[0] + m, center[1], center[2]] },
    { text: `D ${formatMeters(size[2])}`, face: [center[0], center[1], max[2]], label: [center[0], center[1], max[2] + m] },
  ];

  return (
    <>
      {dims.map((d, i) => (
        <React.Fragment key={i}>
          <DimLeader from={d.face} to={d.label} thickness={thick} />
          <Label3D text={d.text} position={d.label} k={k} />
        </React.Fragment>
      ))}
    </>
  );
}

// ------- Per-part dimensions -------

interface PartsProps {
  dimensions: ModelDimensions;
  modelScale?: number;
  labelSize?: number;
}

export function PartDimensionsOverlay({ dimensions, modelScale = 1, labelSize = 1 }: PartsProps) {
  if (!ViroText) return null;
  // Cap displayed parts to avoid cluttering huge assemblies.
  const MAX_PARTS = 40;
  const parts =
    dimensions.parts.length > MAX_PARTS ? dimensions.parts.slice(0, MAX_PARTS) : dimensions.parts;
  const s = modelScale > 0 ? modelScale : 1;
  // Per-part labels are denser, so a touch smaller than the overall labels.
  const k = (LABEL_BASE_K * 0.7 * labelSize) / s;

  return (
    <>
      {parts.map((part, idx) => {
        const longest = Math.max(part.size[0], part.size[1], part.size[2]);
        return (
          <Label3D
            key={`${part.name}-${idx}`}
            text={formatMeters(longest)}
            position={part.center}
            k={k}
          />
        );
      })}
    </>
  );
}

// ------- Ruler overlay (model or real-world) -------

interface RulerProps {
  points: Vec3[];
  colorKey: 'green' | 'blue';
  /** Size multiplier from the Measure panel's Size slider. */
  labelSize?: number;
  /**
   * Divide the measured WORLD distance by this to report a TRUE distance. The
   * model ruler taps the auto-fit-scaled model, so its world distance must be
   * divided by the model scale to read the model's real dimension (matching the
   * Overall labels). Real-world rulers + deviation are already world-true → 1.
   */
  scaleDivisor?: number;
}

function distance(a: Vec3, b: Vec3): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function RulerOverlay({ points, colorKey, labelSize = 1, scaleDivisor = 1 }: RulerProps) {
  if (!ViroNode || !ViroSphere) return null;
  if (points.length === 0) return null;

  const sphereMat = colorKey === 'green' ? 'rulerGreen' : 'rulerBlue';
  const lineMat = colorKey === 'green' ? 'rulerLineGreen' : 'rulerLineBlue';
  // Ruler markers live in world space (scene root), so no model-scale division.
  const k = LABEL_BASE_K * labelSize;

  return (
    <ViroNode>
      {points.map((p, i) => (
        <ViroSphere
          key={`sphere-${i}-${p[0]}-${p[1]}-${p[2]}`}
          position={p}
          radius={0.015}
          materials={[sphereMat]}
        />
      ))}

      {points.length === 2 && ViroPolyline && ViroText && (
        <>
          <ViroPolyline points={[points[0], points[1]]} thickness={0.005} materials={[lineMat]} />
          <Label3D
            text={formatMeters(distance(points[0], points[1]) / (scaleDivisor || 1))}
            position={[
              (points[0][0] + points[1][0]) / 2,
              (points[0][1] + points[1][1]) / 2 + 0.04,
              (points[0][2] + points[1][2]) / 2,
            ]}
            k={k}
          />
        </>
      )}
    </ViroNode>
  );
}
