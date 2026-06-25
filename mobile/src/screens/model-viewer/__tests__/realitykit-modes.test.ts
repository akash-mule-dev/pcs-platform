// Locks in the RealityKit LiDAR toggle → native-prop-flag mapping. The Swift
// side reads these plain booleans, so a wrong flag silently breaks a control.
import { togglesToFlags, DEFAULT_LIDAR_TOGGLES } from '../ar/types';

describe('RealityKit LiDAR occlusion toggle', () => {
  it('defaults to occlusion OFF (complete model visible by default)', () => {
    expect(DEFAULT_LIDAR_TOGGLES).toEqual({ occlusion: false });
  });

  it('occlusion ON enables BOTH scene-depth and people/hand occlusion', () => {
    const f = togglesToFlags({ occlusion: true });
    expect(f.occlusion).toBe(true);
    expect(f.personSegmentation).toBe(true); // hand occlusion travels with occlusion
  });

  it('occlusion OFF shows the complete model (nothing hides it)', () => {
    const f = togglesToFlags({ occlusion: false });
    expect(f.occlusion).toBe(false);
    expect(f.personSegmentation).toBe(false);
  });

  it('never enables mesh, physics, or plane-anchor (debug/demo-only, removed for QA)', () => {
    for (const occlusion of [true, false]) {
      const f = togglesToFlags({ occlusion });
      expect(f.showMesh).toBe(false);
      expect(f.physics).toBe(false);
      expect(f.planeAnchor).toBe(false);
    }
  });
});
