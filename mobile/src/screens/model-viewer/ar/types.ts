// Pure types + constants for the AR QA inspector — framework-agnostic, no
// Viro/native imports, safe to load anywhere (Expo Go / Jest / web).

export type Vec3 = [number, number, number];

export type RenderMode = 'solid' | 'ghost' | 'wireframe';

export type TrackingMode = 'world' | 'plane' | 'image';

// ── Edge-view styling (the Edges panel) ──
// Edge colour is applied LIVE via a per-colour Constant Viro material (no
// regeneration), so swapping colour is instant. Each option names the material
// key registered in ARModelScene; `hex` is the swatch shown in the panel.
export interface EdgeColorOption {
  key: string;
  label: string;
  hex: string;
  /** Viro material key registered in ARModelScene. */
  material: string;
}

export const EDGE_COLORS: EdgeColorOption[] = [
  { key: 'cyan', label: 'Cyan', hex: '#00e5ff', material: 'edge_cyan' },
  { key: 'green', label: 'Green', hex: '#39ff14', material: 'edge_green' },
  { key: 'yellow', label: 'Yellow', hex: '#ffe600', material: 'edge_yellow' },
  { key: 'orange', label: 'Orange', hex: '#ff7a00', material: 'edge_orange' },
  { key: 'magenta', label: 'Pink', hex: '#ff2bd6', material: 'edge_magenta' },
  { key: 'white', label: 'White', hex: '#ffffff', material: 'edge_white' },
];

export const DEFAULT_EDGE_COLOR = EDGE_COLORS[0].hex; // cyan

// Edge thickness is BAKED into the tube geometry (radius), so changing it
// regenerates + re-caches the wireframe GLB at this radius multiplier. The three
// presets map to the line-weight a fabricator picks for visibility.
export type EdgeThickness = 'thin' | 'medium' | 'thick';

export const EDGE_THICKNESS_SCALE: Record<EdgeThickness, number> = {
  thin: 0.55,
  medium: 1,
  thick: 2.2,
};

export const DEFAULT_EDGE_THICKNESS: EdgeThickness = 'medium';

// Lifecycle of the on-device model load. The camera is live the whole time —
// these phases only describe the model streaming in over the live camera.
export type ModelPhase = 'downloading' | 'preparing' | 'ready' | 'error';

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
  // The model auto-places in front of the camera the moment it loads; the modes
  // differ only in how ARKit stabilizes the world afterward.
  world: {
    title: 'World Position',
    subtitle: 'Auto-placed in front. Free tracking — drifts most as you move.',
    accuracy: 'Baseline',
  },
  plane: {
    title: 'Plane Anchor',
    subtitle: 'Auto-placed in front. Plane detection holds it steadier.',
    accuracy: 'High',
  },
  image: {
    title: 'Image Marker',
    subtitle: 'Auto-placed in front. Gravity + heading lock for the steadiest hold.',
    accuracy: 'Highest',
  },
};

// ── Model placement / transform state ──
// Owned by useModelState; rendered by the AR scene. Design facts only — no QA
// data here. `autoFitted` guards the one-shot auto-fit so the bbox read can't
// feedback-loop.
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
  autoFitted: boolean;
}

export type ModelAction =
  | { type: 'SET_URI'; uri: string; fileName: string }
  | { type: 'SET_POSITION'; position: Vec3 }
  | { type: 'NUDGE_POSITION'; delta: Vec3 }
  | { type: 'SET_SCALE'; scale: Vec3 }
  | { type: 'SET_ROTATION'; rotation: Vec3 }
  | { type: 'TOGGLE_LOCK' }
  | { type: 'SET_PLACED'; placed: boolean }
  // Atomic place: set position and mark placed in one render (avoids a flash
  // where the node mounts at the stale position for one frame).
  | { type: 'PLACE'; position: Vec3 }
  // One-shot auto-fit: set the scale derived from the loaded model's bbox and
  // mark autoFitted so it never recomputes.
  | { type: 'APPLY_AUTOFIT'; scale: Vec3 }
  | { type: 'RESET' }
  | { type: 'SET_WIREFRAME_URI'; wireframeUri: string }
  | { type: 'SET_RENDER_MODE'; renderMode: RenderMode };
