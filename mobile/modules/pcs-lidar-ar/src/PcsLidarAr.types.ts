import type { ViewProps } from 'react-native';

export type PcsLidarLoadEvent = { uri: string };
export type PcsLidarErrorEvent = { message: string };
export type PcsLidarTrackingEvent = { state: string; lidar?: boolean };
export type PcsLidarAnchorEvent = { placed: boolean; onSurface: boolean };

/**
 * A measurement update from the native view. `points` are WORLD-space [x,y,z]
 * triples (0–2 of them); `kind` is the active tool. `renderScale` is the model's
 * current total render scale (baseScale × userScale) — divide an on-MODEL world
 * distance by it to recover the model's true (GLB-unit) dimension. Real-world /
 * deviation distances are already true metres. `miss` is set when a capture
 * found no surface/model under the point.
 */
export type PcsLidarMeasureEvent = {
  kind: 'off' | 'model' | 'real' | 'deviation';
  points: [number, number, number][];
  renderScale: number;
  miss?: boolean;
};

/** A part hit-test result (per-part QA): the entity name (== ifc_guid). */
export type PcsLidarPartTapEvent = { name: string; world: [number, number, number] };

/**
 * One captured registration point. `space` is which side it belongs to — a point
 * ON THE MODEL ('model', via hit-test) or its match in the REAL world ('real',
 * via raycast). `point` is world-space [x,y,z]; `miss` is set when nothing was
 * under the tap; `name` (model only) is the picked part's ifc_guid.
 */
export type PcsLidarRegisterPointEvent = {
  space: 'model' | 'real';
  point?: [number, number, number];
  name?: string;
  miss?: boolean;
};

/**
 * Result of an ICP auto-snap. `ok` true → the model pose was refined onto the
 * scanned mesh (residual lowered): `rmsMm` is the new residual, `fromMm` the prior
 * one, `inlierRatio` the model-surface overlap. `ok` false → nothing was applied;
 * `reason` ∈ no-lidar | not-placed | no-model-geometry | sparse-mesh | low-overlap |
 * no-improvement.
 */
export type PcsLidarAutoAlignEvent = {
  ok: boolean;
  reason?: string;
  rmsMm?: number;
  fromMm?: number;
  inlierRatio?: number;
  iterations?: number;
};

/**
 * Props for the native RealityKit LiDAR AR view. The boolean flags are produced
 * by `togglesToFlags()` (see ar/types.ts) so the toggle→flags mapping lives in
 * one place. Event payloads arrive under `event.nativeEvent`.
 */
export type PcsLidarArViewProps = {
  /** GLB to render. A file:// URL (from useRemoteModel) is the normal case. */
  modelUri?: string;
  /** Edge-view (wireframe) GLB, kept ready; `showEdges` decides what's shown. */
  wireframeUri?: string;
  /** Explicit solid↔edges selector (true = show the wireframe variant). */
  showEdges?: boolean;
  /** Edge-view colour (hex, e.g. "#00e5ff") — painted as one uniform flat fill. */
  edgeColor?: string;
  /** Per-entity colour overlay for the SOLID model (Color-by Profile/Grade):
   *  entity-name (== ifc_guid) → hex. Empty/omitted = uniform grey. */
  colorOverlay?: Record<string, string>;
  /** Real-world (LiDAR mesh) occlusion of the virtual model. */
  occlusion?: boolean;
  /** People/hand occlusion (ARKit personSegmentationWithDepth). */
  personSegmentation?: boolean;
  /** Model collides with / rests on the reconstructed mesh. */
  physics?: boolean;
  /** Lock the model to a detected plane anchor. */
  planeAnchor?: boolean;
  /** Draw the LiDAR scene-reconstruction mesh (scanning visualization). */
  showMesh?: boolean;

  /** Arms direct manipulation: one-finger drag slides the model on the surface,
   *  two-finger twist yaws it. Should be off during measure / part-pick / lock. */
  directManipulation?: boolean;

  /** Point-pair registration capture target for the next tap: 'model' (hit-test
   *  the model), 'real' (raycast the world), or 'off'. */
  registerMode?: 'off' | 'model' | 'real';

  /** Active measurement tool. Taps capture points while not 'off'. */
  measureMode?: 'off' | 'model' | 'real' | 'deviation';
  /** When true, a tap reports the hit part's name instead of (re)placing. */
  partPick?: boolean;
  /** Draw a wireframe box around the whole model. */
  showOverallBox?: boolean;
  /** Draw a wireframe box around each part. */
  showPartBoxes?: boolean;

  onLoad?: (event: { nativeEvent: PcsLidarLoadEvent }) => void;
  onError?: (event: { nativeEvent: PcsLidarErrorEvent }) => void;
  onTracking?: (event: { nativeEvent: PcsLidarTrackingEvent }) => void;
  onAnchor?: (event: { nativeEvent: PcsLidarAnchorEvent }) => void;
  onMeasure?: (event: { nativeEvent: PcsLidarMeasureEvent }) => void;
  onPartTap?: (event: { nativeEvent: PcsLidarPartTapEvent }) => void;
  onRegisterPoint?: (event: { nativeEvent: PcsLidarRegisterPointEvent }) => void;
  onAutoAlign?: (event: { nativeEvent: PcsLidarAutoAlignEvent }) => void;
} & ViewProps;

export type PcsLidarArViewRef = {
  resetTracking: () => Promise<void>;
  recenter: () => Promise<void>;
  capture: () => Promise<string | null>;
  /** Align: relative position nudge in metres (anchor-local axes). */
  nudge: (dx: number, dy: number, dz: number) => Promise<void>;
  /** Align: relative position nudge in metres along WORLD axes (e.g. true world-up
   *  for the elevation handle, regardless of the anchor's tilt). */
  nudgeWorld: (dx: number, dy: number, dz: number) => Promise<void>;
  /** Align: relative rotation nudge in degrees [pitch, yaw, roll]. */
  rotateModel: (pitch: number, yaw: number, roll: number) => Promise<void>;
  /** Align: relative uniform scale multiply. */
  scaleModel: (factor: number) => Promise<void>;
  /** Align: freeze/unfreeze the transform + tap-to-place. */
  setModelLocked: (locked: boolean) => Promise<void>;
  /** Measure: capture a point at the screen-centre reticle. */
  capturePoint: () => Promise<void>;
  /** Measure: clear all captured points + geometry. */
  clearMeasurement: () => Promise<void>;
  /** Register: capture the next point at the screen-centre reticle. */
  captureRegisterAtReticle: () => Promise<void>;
  /** Register: drop the most recent captured point. */
  undoRegisterPair: () => Promise<void>;
  /** Register: clear all captured registration points + markers. */
  clearRegistration: () => Promise<void>;
  /** Register: bake a solved rigid transform (column-major 4×4, 16 floats). */
  applyRegistration: (matrix: number[]) => Promise<void>;
  /** Auto-snap: ICP-refine the pose onto the LiDAR mesh (reverts if not better). */
  autoAlign: () => Promise<void>;
  /** See-through overlay: set the model's render opacity (1 = opaque). */
  setModelOpacity: (opacity: number) => Promise<void>;
};
