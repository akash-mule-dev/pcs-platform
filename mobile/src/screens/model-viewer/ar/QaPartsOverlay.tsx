// Per-part bounding-box overlay. One component serves three AR QA features:
//   • Heat-map (#7): a translucent volume per part, colored by its QA status.
//   • Per-part pass/fail (#5): each box is tappable -> onPartTap(meshName).
//   • Focus / isolation (#6): when focusMeshName is set, only that part is
//     drawn, brightly highlighted.
//
// Why bounding boxes and not per-mesh tinting: the model is loaded as a single
// Viro3DObject, so Viro exposes no handle to individual sub-meshes. Boxes are
// derived from dimensionExtractor's per-part bounds (the same data the existing
// QualityStatusOverlay uses) and align with each part in model-local space.
// Lazy-Viro + guards keep this import safe in Expo Go / Jest.
import React from 'react';
import type { ModelDimensions, PartDimension } from './dimensionExtractor';
import type { ARQualityEntry } from './useQualityData';

let ViroNode: any = null;
let ViroBox: any = null;
let ViroText: any = null;
let ViroMaterials: any = null;

try {
  const viro = require('@reactvision/react-viro');
  ViroNode = viro.ViroNode;
  ViroBox = viro.ViroBox;
  ViroText = viro.ViroText;
  ViroMaterials = viro.ViroMaterials;
} catch {
  // Viro unavailable — overlay renders nothing.
}

try {
  ViroMaterials?.createMaterials?.({
    // 8-digit hex = #RRGGBBAA; low alpha keeps the real part visible through it.
    qaBoxPass: { diffuseColor: '#10b98140', lightingModel: 'Constant', blendMode: 'Alpha' },
    qaBoxFail: { diffuseColor: '#ef444455', lightingModel: 'Constant', blendMode: 'Alpha' },
    qaBoxWarning: { diffuseColor: '#f59e0b4d', lightingModel: 'Constant', blendMode: 'Alpha' },
    qaBoxNeutral: { diffuseColor: '#3b82f626', lightingModel: 'Constant', blendMode: 'Alpha' },
    qaBoxFocus: { diffuseColor: '#22d3ee66', lightingModel: 'Constant', blendMode: 'Alpha' },
  });
} catch {
  // ignore
}

const STATUS_MATERIAL: Record<string, string> = {
  pass: 'qaBoxPass',
  fail: 'qaBoxFail',
  warning: 'qaBoxWarning',
};

const LABEL_STYLE = {
  fontFamily: 'Arial',
  fontSize: 12,
  color: '#ffffff',
  textAlign: 'center' as const,
  textAlignVertical: 'center' as const,
};

interface Props {
  dimensions: ModelDimensions | null;
  /** Latest-status-per-mesh comes from these (for heat-map coloring). */
  entries?: ARQualityEntry[];
  /** Render boxes tappable and route taps to this handler (per-part pass/fail). */
  selectable?: boolean;
  onPartTap?: (meshName: string) => void;
  /** When set, ONLY this part is drawn, highlighted (isolation / focus). */
  focusMeshName?: string | null;
  /** Cap to avoid clutter on huge assemblies. */
  maxParts?: number;
}

function latestStatusByMesh(entries: ARQualityEntry[] | undefined): Map<string, string> {
  const m = new Map<string, string>();
  if (!entries) return m;
  // entries arrive newest-first from the API; keep the first seen per mesh.
  for (const e of entries) {
    if (!m.has(e.meshName)) m.set(e.meshName, e.status);
  }
  return m;
}

export function QaPartsOverlay({
  dimensions,
  entries,
  selectable,
  onPartTap,
  focusMeshName,
  maxParts = 60,
}: Props) {
  if (!ViroNode || !ViroBox || !dimensions) return null;

  const statusByMesh = latestStatusByMesh(entries);

  let parts: PartDimension[] = dimensions.parts;
  if (focusMeshName) {
    parts = parts.filter((p) => p.name === focusMeshName);
  } else if (parts.length > maxParts) {
    parts = parts.slice(0, maxParts);
  }

  return (
    <>
      {parts.map((part, i) => {
        const focused = !!focusMeshName && part.name === focusMeshName;
        const status = statusByMesh.get(part.name);
        const material = focused
          ? 'qaBoxFocus'
          : status
            ? STATUS_MATERIAL[status] || 'qaBoxNeutral'
            : 'qaBoxNeutral';

        const w = Math.max(0.001, part.size[0]);
        const h = Math.max(0.001, part.size[1]);
        const l = Math.max(0.001, part.size[2]);

        const tapProps =
          selectable && onPartTap ? { onClick: () => onPartTap(part.name) } : {};

        return (
          <ViroNode key={`${part.name}-${i}`} position={part.center}>
            <ViroBox
              width={w}
              height={h}
              length={l}
              materials={[material]}
              {...tapProps}
            />
            {focused && ViroText && (
              <ViroText
                text={part.name}
                position={[0, h / 2 + 0.05, 0]}
                style={LABEL_STYLE}
                width={1}
                height={0.2}
                extrusionDepth={0}
              />
            )}
          </ViroNode>
        );
      })}
    </>
  );
}
