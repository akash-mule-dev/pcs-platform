// Ported from the standalone glb-viewer app (Expo AR QA inspector).
// Pure types + constants — framework-agnostic, no Viro/native imports.

export type Vec3 = [number, number, number];

export type RenderMode = 'solid' | 'ghost' | 'wireframe';

export type TrackingMode = 'world' | 'plane' | 'image';

export interface MeasurementState {
  showOverall: boolean;
  showParts: boolean;
  modelRulerActive: boolean;
  realRulerActive: boolean;
  modelRulerPoints: Vec3[]; // up to 2 points, in model-local space
  realRulerPoints: Vec3[]; // up to 2 points, in world space
  // Deviation probe: pair a point on the virtual model with the matching point
  // on the real part to measure how far the as-built deviates from the model.
  deviationActive: boolean;
  deviationModelPoint: Vec3 | null; // first tap, on the model
  deviationRealPoint: Vec3 | null; // second tap, on the real surface
}

export const DEFAULT_MEASUREMENTS: MeasurementState = {
  showOverall: false,
  showParts: false,
  modelRulerActive: false,
  realRulerActive: false,
  modelRulerPoints: [],
  realRulerPoints: [],
  deviationActive: false,
  deviationModelPoint: null,
  deviationRealPoint: null,
};

export const TRACKING_MODE_INFO: Record<
  TrackingMode,
  { title: string; subtitle: string; accuracy: string }
> = {
  world: {
    title: 'World Position',
    subtitle: 'Drag to place anywhere. Drifts as you move.',
    accuracy: 'Baseline',
  },
  plane: {
    title: 'Plane Anchor',
    subtitle: 'Tap a detected surface. ARKit/ARCore keeps it fixed.',
    accuracy: 'High',
  },
  image: {
    title: 'Image Marker',
    subtitle: 'Locks to a printed reference image on the object.',
    accuracy: 'Highest',
  },
};

export interface ModelState {
  uri: string | null;
  fileName: string | null;
  position: Vec3;
  scale: Vec3;
  rotation: Vec3;
  locked: boolean;
  placed: boolean;
  wireframeUri: string | null;
  renderMode: RenderMode;
}

export type ModelAction =
  | { type: 'SET_URI'; uri: string; fileName: string }
  | { type: 'SET_POSITION'; position: Vec3 }
  | { type: 'NUDGE_POSITION'; delta: Vec3 }
  | { type: 'SET_SCALE'; scale: Vec3 }
  | { type: 'SET_ROTATION'; rotation: Vec3 }
  | { type: 'TOGGLE_LOCK' }
  | { type: 'SET_PLACED'; placed: boolean }
  | { type: 'RESET' }
  | { type: 'SET_WIREFRAME_URI'; wireframeUri: string }
  | { type: 'CYCLE_RENDER_MODE' }
  | { type: 'SET_RENDER_MODE'; renderMode: RenderMode };
