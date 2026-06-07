// Ported from glb-viewer, adapted for PCS: Viro is lazy-`require`d (not a static
// import) and material registration is guarded, so importing this module never
// crashes in Expo Go / Jest where the native Viro module is unavailable.
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
  });
} catch {
  // ignore
}

const LABEL_STYLE = {
  fontFamily: 'Arial',
  fontSize: 14,
  color: '#ffffff',
  textAlign: 'center' as const,
  textAlignVertical: 'center' as const,
};

const LABEL_WIDTH = 1.2;
const LABEL_HEIGHT = 0.25;

// ------- Overall W × H × D -------

interface OverallProps {
  dimensions: ModelDimensions;
}

export function OverallDimensionsOverlay({ dimensions }: OverallProps) {
  if (!ViroText) return null;
  const { min, max, size, center } = dimensions.overall;

  // Place labels slightly outside each edge of the box
  const widthLabelPos: Vec3 = [center[0], min[1] - 0.05, max[2]];
  const heightLabelPos: Vec3 = [max[0] + 0.05, center[1], max[2]];
  const depthLabelPos: Vec3 = [max[0], min[1] - 0.05, center[2]];

  return (
    <>
      <ViroText
        text={`W ${formatMeters(size[0])}`}
        position={widthLabelPos}
        style={LABEL_STYLE}
        width={LABEL_WIDTH}
        height={LABEL_HEIGHT}
        extrusionDepth={0}
      />
      <ViroText
        text={`H ${formatMeters(size[1])}`}
        position={heightLabelPos}
        style={LABEL_STYLE}
        width={LABEL_WIDTH}
        height={LABEL_HEIGHT}
        extrusionDepth={0}
      />
      <ViroText
        text={`D ${formatMeters(size[2])}`}
        position={depthLabelPos}
        style={LABEL_STYLE}
        width={LABEL_WIDTH}
        height={LABEL_HEIGHT}
        extrusionDepth={0}
      />
    </>
  );
}

// ------- Per-part dimensions -------

interface PartsProps {
  dimensions: ModelDimensions;
}

export function PartDimensionsOverlay({ dimensions }: PartsProps) {
  if (!ViroText) return null;
  // Cap displayed parts to avoid cluttering huge assemblies
  const MAX_PARTS = 40;
  const parts =
    dimensions.parts.length > MAX_PARTS
      ? dimensions.parts.slice(0, MAX_PARTS)
      : dimensions.parts;

  return (
    <>
      {parts.map((part, idx) => {
        const [w, h, d] = part.size;
        const longest = Math.max(w, h, d);
        const label = `${formatMeters(longest)}`;
        return (
          <ViroText
            key={`${part.name}-${idx}`}
            text={label}
            position={part.center}
            style={{ ...LABEL_STYLE, fontSize: 10 }}
            width={0.6}
            height={0.15}
            extrusionDepth={0}
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
}

function distance(a: Vec3, b: Vec3): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function RulerOverlay({ points, colorKey }: RulerProps) {
  if (!ViroNode || !ViroSphere) return null;
  if (points.length === 0) return null;

  const sphereMat = colorKey === 'green' ? 'rulerGreen' : 'rulerBlue';
  const lineMat = colorKey === 'green' ? 'rulerLineGreen' : 'rulerLineBlue';

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
          <ViroPolyline
            points={[points[0], points[1]]}
            thickness={0.005}
            materials={[lineMat]}
          />
          <ViroText
            text={formatMeters(distance(points[0], points[1]))}
            position={[
              (points[0][0] + points[1][0]) / 2,
              (points[0][1] + points[1][1]) / 2 + 0.04,
              (points[0][2] + points[1][2]) / 2,
            ]}
            style={LABEL_STYLE}
            width={0.8}
            height={0.2}
            extrusionDepth={0}
          />
        </>
      )}
    </ViroNode>
  );
}
