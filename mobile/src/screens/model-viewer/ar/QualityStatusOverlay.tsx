// Renders a colored marker (sphere + status label) at each inspected region's
// centroid inside the AR scene, so pass/fail/warning is visible on the model.
// Regions are matched to geometry by meshName === dimension part name (same
// convention the web Quality viewer uses). Lazy-Viro so import is Expo-Go safe.
import React from 'react';
import { ModelDimensions } from './dimensionExtractor';
import { ARQualityEntry } from './useQualityData';

let ViroNode: any = null;
let ViroSphere: any = null;
let ViroText: any = null;
let ViroMaterials: any = null;

try {
  const viro = require('@reactvision/react-viro');
  ViroNode = viro.ViroNode;
  ViroSphere = viro.ViroSphere;
  ViroText = viro.ViroText;
  ViroMaterials = viro.ViroMaterials;
} catch {
  // Viro unavailable — overlay renders nothing.
}

try {
  ViroMaterials?.createMaterials?.({
    qaPass: { diffuseColor: '#2e7d32', lightingModel: 'Constant' },
    qaFail: { diffuseColor: '#c62828', lightingModel: 'Constant' },
    qaWarning: { diffuseColor: '#f9a825', lightingModel: 'Constant' },
  });
} catch {
  // ignore
}

const MATERIAL: Record<string, string> = {
  pass: 'qaPass',
  fail: 'qaFail',
  warning: 'qaWarning',
};

const LABEL_STYLE = {
  fontFamily: 'Arial',
  fontSize: 13,
  color: '#ffffff',
  textAlign: 'center' as const,
  textAlignVertical: 'center' as const,
};

interface Props {
  entries: ARQualityEntry[];
  dimensions: ModelDimensions | null;
}

export function QualityStatusOverlay({ entries, dimensions }: Props) {
  if (!ViroNode || !ViroSphere || !dimensions || entries.length === 0) return null;

  const partByName = new Map(dimensions.parts.map((p) => [p.name, p]));

  return (
    <>
      {entries.map((entry) => {
        const part = partByName.get(entry.meshName);
        if (!part) return null; // region without matching geometry — shown in the panel only
        const material = MATERIAL[entry.status] || 'qaWarning';
        return (
          <ViroNode key={entry.id} position={part.center}>
            <ViroSphere radius={0.02} materials={[material]} />
            {ViroText && (
              <ViroText
                text={entry.status.toUpperCase()}
                position={[0, 0.05, 0]}
                style={LABEL_STYLE}
                width={0.6}
                height={0.15}
                extrusionDepth={0}
              />
            )}
          </ViroNode>
        );
      })}
    </>
  );
}
