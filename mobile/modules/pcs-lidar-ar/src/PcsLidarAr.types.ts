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
  /** True when emitted by the continuous world-lock (refineLock) rather than the
   *  user-tapped Auto-snap — JS reports continuous failures silently. */
  continuous?: boolean;
};

/** One marker in an onMarkerUpdate snapshot. `transform` is the marker's WORLD pose
 *  (column-major 16); `tracked` = ARKit is tracking it this frame; `bound` = the model
 *  has an offset stored against it; `distance` = metres from the camera. */
export type PcsLidarMarker = {
  name: string;
  transform: number[];
  tracked: boolean;
  bound: boolean;
  distance: number;
};

/** Throttled (~8 Hz) snapshot of the detected printed markers + native's active pick.
 *  `active` is the marker currently driving the pose (null = none). */
export type PcsLidarMarkerUpdateEvent = {
  markers: PcsLidarMarker[];
  cameraPos: [number, number, number];
  active: string | null;
  lockEnabled: boolean;
  /** Markers actually contributing to the fused pose (bound + tracked + in range). */
  acceptedCount?: number;
  /** Lock armed + bound but nothing acceptable in view → model frozen on last pose. */
  holding?: boolean;
};

/** Acknowledgement of a marker bind / clear / lock toggle. `bound` = how many markers
 *  were just bound; `totalBindings` = total stored; `reason` ∈ ok | no-markers-visible |
 *  not-placed | cleared. */
export type PcsLidarLockStatusEvent = {
  lockEnabled?: boolean;
  bound?: number;
  totalBindings?: number;
  reason?: string;
};

/**
 * Scan-before-place readiness (only while a model is loaded but not yet placed in
 * `manualPlacement` mode). `ready` = the scene is mapped enough to place (normal
 * tracking + a real mapped surface under the reticle). `tracking` is the current
 * ARKit tracking state; `reason` is set on a failed placeNow (e.g. 'no-surface').
 */
export type PcsLidarScanStateEvent = {
  ready: boolean;
  tracking: string;
  reason?: string;
};

/**
 * Props for the native RealityKit LiDAR AR view. The boolean flags are produced
 * by `togglesToFlags()` (see ar/types.ts) so the toggle→flags mapping lives in
 * one place. Event payloads arrive under `event.nativeEvent`.
 */
/**
 * A pose tick for the stability benchmark (markers-OFF vs markers-ON). `model` is the
 * model's WORLD transform (column-major 16); `refMarker` the nearest TRACKED marker's
 * WORLD transform (the drift-free reference), if any; `markerActive` = a marker is
 * currently driving the pose. Emitted only while `poseSampling` is true.
 */
export type PcsLidarPoseSampleEvent = {
  t: number;
  model: number[];
  refMarker?: number[];
  markerActive?: boolean;
  tracking?: string;
};

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
  /** True 1:1 scale: metres-per-GLB-unit (calibrated from part lengths). >0 renders
   *  at the real assembly's size; 0/omitted keeps the fixed fit-scale. */
  realScale?: number;
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
  /** Scan-before-place: hold a freshly loaded model until the user has mapped the
   *  area and calls placeNow(). False/omitted = auto-place on load. */
  manualPlacement?: boolean;

  /** Image-marker lock (FabStation-style anti-drift): when true, the model is
   *  continuously driven by the nearest bound printed marker's live pose. */
  markerLock?: boolean;
  /** Printed marker physical edge length in metres (default 0.15). */
  markerWidthMeters?: number;
  /** Draw a colour-keyed highlight frame on each DETECTED printed marker (so the
   *  inspector sees what the engine recognises + each marker's state). Default on. */
  markerHighlight?: boolean;
  /** Stream onPoseSample (model + nearest-marker world pose) for the stability
   *  benchmark. Keep it off except while recording a run — it's per-frame telemetry. */
  poseSampling?: boolean;

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
  onScanState?: (event: { nativeEvent: PcsLidarScanStateEvent }) => void;
  onMarkerUpdate?: (event: { nativeEvent: PcsLidarMarkerUpdateEvent }) => void;
  onLockStatus?: (event: { nativeEvent: PcsLidarLockStatusEvent }) => void;
  onPoseSample?: (event: { nativeEvent: PcsLidarPoseSampleEvent }) => void;
} & ViewProps;

export type PcsLidarArViewRef = {
  resetTracking: () => Promise<void>;
  recenter: () => Promise<void>;
  /** Scan-first: anchor the model at the reticle after the area is scanned. */
  placeNow: () => Promise<void>;
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
  /** Marker lock: bind every currently-tracked marker to the model's current pose. */
  bindVisibleMarkers: () => Promise<void>;
  /** Marker lock: drop all marker bindings. */
  clearMarkerBindings: () => Promise<void>;
  /** Continuous world-lock: ease the model onto the LiDAR mesh (JS-scheduled). */
  refineLock: () => Promise<void>;
  /** Export a printable PNG (base64) contact sheet of the markers for the shop. */
  exportMarkerSheet: () => Promise<string | null>;
};
