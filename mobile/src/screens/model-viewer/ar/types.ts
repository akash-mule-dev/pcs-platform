// Pure types + constants for the AR QA inspector — framework-agnostic, no
// Viro/native imports, safe to load anywhere (Expo Go / Jest / web).

export type Vec3 = [number, number, number];

export type RenderMode = 'solid' | 'wireframe';

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
  { key: 'red', label: 'Red', hex: '#ff3b30', material: 'edge_red' },
  { key: 'blue', label: 'Blue', hex: '#0a84ff', material: 'edge_blue' },
  { key: 'yellow', label: 'Yellow', hex: '#ffe600', material: 'edge_yellow' },
  { key: 'orange', label: 'Orange', hex: '#ff7a00', material: 'edge_orange' },
  { key: 'magenta', label: 'Pink', hex: '#ff2bd6', material: 'edge_magenta' },
  { key: 'white', label: 'White', hex: '#ffffff', material: 'edge_white' },
];

// Default edge/border colour — RED. The model loads with a high-visibility red
// outline over the real part (the AR inspection overlay look), not plain cyan.
export const DEFAULT_EDGE_COLOR =
  EDGE_COLORS.find((c) => c.key === 'red')?.hex ?? EDGE_COLORS[0].hex; // #ff3b30

// Edge weight (line thickness) is BAKED into the tube geometry (radius), adjusted
// via a thickness SLIDER (no discrete presets). Default is Fine; the slider spans
// [EDGE_WEIGHT_MIN … EDGE_WEIGHT_MAX] = Fine … Thin (Medium/Thick removed).
export const DEFAULT_EDGE_WEIGHT = 0.1;  // Fine — the default render weight
export const EDGE_WEIGHT_MIN = 0.1;      // Fine — nothing thinner
export const EDGE_WEIGHT_MAX = 0.55;     // Thin — nothing thicker (no Medium/Thick)

// Initial model opacity for the AR overlay (1 = solid). The model loads at 25%
// (heavily see-through) so the real part stays clearly visible through it for QA
// overlay — the "see-through" inspection look. Only the LiDAR engine renders opacity.
export const DEFAULT_MODEL_OPACITY = 0.25;

// Lifecycle of the on-device model load. The camera is live the whole time —
// these phases only describe the model streaming in over the live camera.
export type ModelPhase = 'downloading' | 'preparing' | 'ready' | 'error';

export interface MeasurementState {
  showOverall: boolean;
  showParts: boolean;
  modelRulerActive: boolean;
  realRulerActive: boolean;
  // Both up to 2 points, in WORLD space. Model-ruler points are taps on the
  // autofit-scaled model, so divide their world distance by the model scale
  // (state.scale[0]) to recover the model's true dimension.
  modelRulerPoints: Vec3[];
  realRulerPoints: Vec3[];
  // Deviation probe: pair a point on the virtual model with the matching point
  // on the real part to measure how far the as-built deviates from the model.
  deviationActive: boolean;
  deviationModelPoint: Vec3 | null; // first tap, on the model
  deviationRealPoint: Vec3 | null; // second tap, on the real surface
  // Multiplier for the 3D label size (the Measure panel's Size slider). The
  // overlays counter-scale by the model's autofit scale, so this reads as a
  // stable on-screen size regardless of the model.
  labelSize: number;
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
  labelSize: 1,
};

export const LABEL_SIZE_MIN = 0.3;
export const LABEL_SIZE_MAX = 4;

export const TRACKING_MODE_INFO: Record<
  TrackingMode,
  { title: string; subtitle: string; accuracy: string }
> = {
  // The model auto-places in front of the camera the moment it loads. All modes
  // now use gravity-locked tracking with plane detection on; they differ only in
  // the world-alignment reference ARKit uses.
  world: {
    title: 'World Position',
    subtitle: 'Auto-placed in front. Gravity-locked tracking.',
    accuracy: 'Standard',
  },
  plane: {
    title: 'Plane Anchor',
    subtitle: 'Auto-placed in front. Gravity-locked, plane detection on.',
    accuracy: 'Standard',
  },
  image: {
    title: 'Image Marker',
    subtitle: 'Auto-placed in front. Gravity + compass-heading reference.',
    accuracy: 'Heading-locked',
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

// ── AR engine selection (additive — does NOT touch TrackingMode above) ──
// Two rendering engines back the AR view:
//   • 'viro'       — @reactvision/react-viro; the 3 TrackingModes; all devices.
//   • 'realitykit' — native RealityKit ARView (modules/pcs-lidar-ar); the LiDAR
//                    modes below; iPad + LiDAR only. Viro physically cannot use
//                    the depth sensor, so these modes live in a separate engine.
export type Engine = 'viro' | 'realitykit';

// The native LiDAR mixed-reality control reduces to a SINGLE thing inspection
// actually needs — occlusion:
//   • occlusion ON  — real objects + the inspector's hand correctly hide the
//     model (the depth/LiDAR showcase).
//   • occlusion OFF — the COMPLETE model is always visible, drawing over the real
//     world, so it can never disappear behind a wall.
// The mesh-scan overlay, physics, and plane-anchor were demo/debug aids and are
// intentionally NOT exposed: they clutter or destabilise an inspection. The model
// already rides a stable world anchor.
export interface LidarToggles {
  occlusion: boolean;
}

// The native-view boolean props the toggle maps to. Scene reconstruction (the
// LiDAR mesh feed) is enabled once natively at session start when supported.
export interface RealityKitModeFlags {
  occlusion: boolean;
  personSegmentation: boolean;
  physics: boolean;
  planeAnchor: boolean;
  showMesh: boolean;
}

// Single source of truth for the toggle → native-prop mapping (so Swift only ever
// reads plain booleans and never duplicates this table). Hand occlusion
// (personSegmentation) travels WITH occlusion; mesh/physics/plane-anchor stay off.
export function togglesToFlags(t: LidarToggles): RealityKitModeFlags {
  return {
    occlusion: t.occlusion,
    personSegmentation: t.occlusion,
    physics: false,
    planeAnchor: false,
    showMesh: false,
  };
}

// Occlusion defaults OFF — inspectors want the COMPLETE model visible by default
// (it never hides behind a wall); occlusion is opt-in for the hand/depth check.
export const DEFAULT_LIDAR_TOGGLES: LidarToggles = { occlusion: false };
