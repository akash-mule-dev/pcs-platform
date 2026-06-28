// PcsLidarArView — the native iPad LiDAR mixed-reality engine.
//
// A RealityKit `ARView` hosted inside an Expo `ExpoView`, exposed to React
// Native as the <PcsLidarArView> component. This is the engine the Viro stack
// could never be: it drives ARKit's LiDAR scene reconstruction, scene-depth
// occlusion, people/hand occlusion, and physics against the real-world mesh.
//
// It also reaches FEATURE PARITY with the Viro inspector so the LiDAR mode is
// production-ready for quality inspection:
//   • ALIGN   — nudge / rotate / scale / lock the placed model (a pivot carries
//               the user transform so the model stays centred + base-on-surface).
//   • MEASURE — LiDAR raycast point-to-point measurement: a real-world ruler
//               (mesh/plane hits — accurate, the LiDAR payoff), an on-model ruler
//               (collision hit-test), and a model↔real DEVIATION probe. Captured
//               points are drawn as markers + a line; distances surface in JS.
//   • EDGES   — an in-place variant swap to the wireframe GLB (materials preserved
//               so the baked edge colour survives), keeping placement + transform.
//   • DIMENSIONS — wireframe bounding boxes (overall + per-part) wrapping the model.
//   • PART TAP — hit-test a part and report its name (per-part QA inspection).
//
// Model loading is OPTIONAL at compile time: if the GLTFKit2 package is linked
// (see README), real GLBs load via GltfModelLoader; otherwise the view falls
// back to a placeholder box so every LiDAR mode is still demonstrable on a
// first build with zero third-party dependencies.
//
// IMPORTANT (verified API rules, ARKit/RealityKit iOS 17/18):
//  • sceneReconstruction (.mesh) + frameSemantics (.personSegmentationWithDepth)
//    are ARKit CONFIG properties — changing them needs `session.run(config)`.
//  • environment.sceneUnderstanding.options (.occlusion/.physics/.collision) and
//    debugOptions (.showSceneUnderstanding) are LIVE ARView toggles — no re-run.
//  We enable the LiDAR mesh ONCE at start, then mode switches are pure live
//  toggles; only entering/leaving people-occlusion re-runs the session (without
//  reset flags, so the placed model + tracking survive).
import ExpoModulesCore
import ARKit
import RealityKit
import simd
import UIKit
import ImageIO  // CGImagePropertyOrientation (ARReferenceImage init)

class PcsLidarArView: ExpoView, ARSessionDelegate, UIGestureRecognizerDelegate {
  // Event names MUST exactly match the Events(...) declared in PcsLidarArModule.
  let onLoad = EventDispatcher()
  let onError = EventDispatcher()
  let onTracking = EventDispatcher()
  let onAnchor = EventDispatcher()
  let onMeasure = EventDispatcher()
  let onPartTap = EventDispatcher()
  let onRegisterPoint = EventDispatcher()
  let onAutoAlign = EventDispatcher()
  let onScanState = EventDispatcher()
  // Image-marker stabilization telemetry (FabStation-style anti-drift).
  let onMarkerUpdate = EventDispatcher()  // the live marker set + native's active pick
  let onLockStatus = EventDispatcher()    // bind/clear/lock-toggle acknowledgements

  private let arView = ARView(frame: .zero)
  private let config = ARWorldTrackingConfiguration()
  private var meshSupported = false

  // Desired mode flags, set from JS props (see modeToFlags in types.ts).
  private var wantOcclusion = false
  private var wantPeople = false
  private var wantPhysics = false
  private var wantPlaneAnchor = false
  private var wantShowMesh = false

  // ── Model + placement ──
  // modelEntity (the GLB) is positioned so its base-centre sits at the origin,
  // then parented under modelPivot, which carries the USER transform (scale /
  // rotation / translate) — so Align edits never disturb the centring, and yaw
  // spins the model in place on the surface. modelPivot is the child of the
  // surface-anchored modelAnchor.
  private var modelEntity: Entity?            // the SOLID model — always present once loaded
  private var modelPivot: Entity?
  private var modelAnchor: AnchorEntity?
  // The SESSION-TRACKED ARKit anchor backing modelAnchor. The model is anchored to a
  // real ARAnchor (added to the session) rather than a static world coordinate, so it
  // rides ARKit's MAP-REFINEMENT corrections — loop closure, interruption recovery, a
  // restored world map — which a free AnchorEntity(world:) never receives. NOTE: a
  // user-created ARAnchor is NOT continuously nudged frame-to-frame, so this does not
  // by itself cancel the steady-state VIO drift you accumulate walking the length of a
  // large piece; that residual is handled by re-running auto-snap (ICP) / point-pair
  // registration at the far end. The bigger far-end win is the 1:1 scale fix: with a
  // correctly-scaled model, aligning one end lines the whole piece up.
  private var modelArAnchor: ARAnchor?
  // Correction node BETWEEN the (ARKit-driven) anchor and the user pivot:
  //   modelAnchor (rides relocalization) → modelCorrection (registration / one-shot
  //   auto-snap delta) → modelPivot (user transform) → entity.
  // A solved correction (point-pair registration or the manual one-shot Auto-snap) is
  // applied here (in the anchor's local frame) instead of tearing down + re-seating the
  // ARAnchor — so the long-lived anchor keeps its relocalization continuity. Identity
  // until the first correction.
  private var modelCorrection: Entity?
  private var pendingPlacement = false
  private var placeAttempts = 0
  // Scan-before-place gate. When manualPlacement is on, the model is NOT auto-placed
  // on load; it waits until the user has scanned the area (ARKit tracking == normal
  // with a real mapped surface under the reticle) and taps Place. Anchoring into a
  // well-mapped scene markedly reduces later drift vs anchoring against a half-
  // initialised world map. (This does NOT affect scale — the model is 1:1 from
  // realScale regardless; scanning buys placement quality + tracking stability.)
  private var manualPlacement = false
  private var awaitingManualPlace = false
  private var lastTrackingState = "starting"
  private var lastScanReady: Bool? = nil
  private var loadToken = UUID()
  // Edges are a COMPOSITE overlay, not a variant swap: the solid model is ALWAYS
  // shown (so Colour-by + see-through opacity apply in BOTH view modes), and in
  // "edges" view the wireframe tubes are added ON TOP as a separate, collision-free
  // child of the pivot. Driven by the explicit (wantEdges, uris) state — not a prop
  // going nil (fragile under Expo).
  private var solidUri: URL?                  // the solid model
  private var wireframeUri: URL?              // the edge-tube overlay (if any)
  private var wantEdges = false               // overlay the edges on top of the solid?
  private var loadedSolidUri: URL?            // solid currently loaded
  private var edgeEntity: Entity?             // the edge-tube overlay entity (if shown)
  private var loadedEdgeUri: URL?             // wireframe currently overlaid
  private var edgeLoadToken = UUID()          // guards async edge loads (weight-slider spam)

  // Flat unlit fill colours (no lighting → one uniform colour across the whole
  // assembly, no gradient). Solid = steel grey; the wireframe is painted with the
  // user-chosen edge colour (driven by the `edgeColor` prop).
  private let solidColor = UIColor(red: 0.67, green: 0.70, blue: 0.74, alpha: 1.0)
  private var wireframeTint = UIColor(red: 0.0, green: 0.9, blue: 1.0, alpha: 1.0) // ~#00e5ff
  // See-through overlay opacity (Phase 3): 1 = opaque; <1 paints the model
  // semi-transparent so the real assembly shows through to verify alignment.
  // Persisted across variant swaps / recolours so the overlay doesn't flicker back.
  private var modelOpacity: Float = 1

  // Per-entity colour overlay (Color-by Profile/Grade), keyed by entity name
  // (== ifc_guid) → UIColor. Applies ONLY to the SOLID model; empty = the uniform
  // steel grey. Unmapped meshes get a neutral "ghost" grey so coloured members pop
  // (mirrors the web/3D-viewer colorOverlay, which ghosts non-mapped meshes).
  private var colorOverlay: [String: UIColor] = [:]
  private let ghostColor = UIColor(red: 0.55, green: 0.60, blue: 0.66, alpha: 1.0)

  // TRUE 1:1 scale: metres-per-GLB-unit, calibrated JS-side from each part's real
  // length (length_mm) vs its GLB bounding box. When >0 it REPLACES the loader's
  // fixed 0.6 m auto-fit so the model renders at the real assembly's size (the AR
  // overlay point). 0 = unknown → keep the fit fallback. The Align scale (userScale)
  // multiplies this, so the operator can still nudge it.
  private var realScale: Float = 0

  // ── User transform (Align) ──
  private var userScale: Float = 1
  // Rotation is a single quaternion, NOT accumulated Euler angles. Each Turn/Tilt/
  // Roll nudge rotates about a FIXED WORLD axis (composed onto this), so the three
  // controls stay independent and can never collapse onto one another — the Euler
  // gimbal-lock that made Turn ≡ Roll once the model was tilted ~90° is gone.
  private var userOrientation = simd_quatf(angle: 0, axis: SIMD3<Float>(0, 1, 0)) // identity
  private var userTranslate = SIMD3<Float>(repeating: 0)
  private var locked = false

  // ── Direct manipulation (Phase 1) ──
  private var directManipulation = false
  private var panOnModel = false                    // did the current drag start on the model?
  private var rotateBaselineRotation: Float = 0     // gesture rotation captured at twist .began
  private var dragGrabOffset = SIMD2<Float>(0, 0)   // world XZ: pivot-origin − grab hit point
  private var dragPlaneY: Float = 0                 // world Y of the drag plane (model height at grab)
  private let dragHaptics = UIImpactFeedbackGenerator(style: .soft)

  // ── Point-pair registration (Phase 2) ──
  // Capture a point ON THE MODEL (hit-test, "model") then the SAME point in
  // REALITY (raycast, "real"); JS solves the rigid transform and calls
  // applyRegistration to snap the pose. Points are world-space; markers/lines live
  // on a world-fixed anchor.
  private var registerMode = "off"                  // off | model | real
  private var registerAnchor: AnchorEntity?
  private var registerMarkers: [Entity] = []
  private var registerModelPoints: [SIMD3<Float>] = []
  private var registerRealPoints: [SIMD3<Float>] = []

  // ── Image-marker stabilization (FabStation-style anti-drift) ──
  // FabStation (Vuforia Image Targets) kills drift by sticking printed markers on the
  // steel and re-anchoring the model to whichever one you've walked up to. ARKit's
  // analog: register the printed markers as ARReferenceImages on the WORLD-tracking
  // config (so LiDAR mesh + occlusion are KEPT — unlike ARImageTrackingConfiguration),
  // and bind the model to a marker by storing its pose offset in that marker's local
  // frame. An ARImageAnchor is re-solved against the PHYSICAL marker every frame, so
  // driving the model from `markerWorldLive · offset` cancels the steady-state VIO
  // drift a free anchor accrues as you walk a long piece — the gap this engine's own
  // comments flagged. The per-frame drive is native (here); the active-marker POLICY
  // is the unit-tested marker-lock.ts mirrored in selectActiveMarkerNative().
  private var markerLockEnabled = false
  private var markerWidthMeters: Float = 0.15           // printed marker edge length (m)
  private var referenceImages: Set<ARReferenceImage> = []
  private var detectionConfigured = false
  private var markerEntities: [String: AnchorEntity] = [:]   // name → RealityKit anchor (ARKit auto-tracks it)
  private var markerTracked: [String: Bool] = [:]            // name → tracked THIS frame?
  private var markerBindings: [String: simd_float4x4] = [:]  // name → offset (markerWorld⁻¹ · correctionWorld) at bind
  private var activeMarkerName: String?                      // the marker currently driving the pose
  private var lastMarkerEmit = Date(timeIntervalSince1970: 0)
  // Item 1+2 — fusion / quality-gating tuning.
  private let markerMaxRangeM: Float = 3.0      // beyond this a marker is dropped (weight 0)
  private let markerNearFavorM: Float = 0.5     // distance falloff scale (closer = higher weight)
  private let markerRejectStepM: Float = 0.30   // reject a fused target this far from current (outlier)
  private var markerOutlierStreak = 0           // consecutive rejects (accept after a few → no permanent stuck)
  // How many markers the runtime generator makes (== the printable sheet). A curated
  // bundled "PcsMarkers" AR Resources group, if present, overrides this for tracking
  // quality (see buildReferenceImages).
  private static let generatedMarkerCount = 12

  // ── Measurement ──
  private var measureMode = "off"             // off | model | real | deviation
  private var measurePoints: [SIMD3<Float>] = []
  private var measureAnchor: AnchorEntity?    // world-fixed; markers/line live here
  private var measureMarkers: [Entity] = []
  private var measureLine: Entity?

  // ── Dimensions + part pick ──
  private var showOverallBox = false
  private var showPartBoxes = false
  private var dimsContainer: Entity?          // child of modelPivot
  private var partPick = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    arView.session.delegate = self
    arView.automaticallyConfigureSession = false  // we own the configuration
    addSubview(arView)

    let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
    tap.delegate = self
    arView.addGestureRecognizer(tap)

    // Direct manipulation (Phase 1): one-finger drag slides the model across the
    // surface, two-finger twist yaws it. They're armed via the directManipulation
    // prop and routed to the pivot — NOT ARView.installGestures(), which would
    // transform the entity in its own space, fight the centring, and re-enable scale.
    let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
    pan.maximumNumberOfTouches = 1
    pan.delegate = self
    arView.addGestureRecognizer(pan)

    let rotate = UIRotationGestureRecognizer(target: self, action: #selector(handleRotate(_:)))
    rotate.delegate = self
    arView.addGestureRecognizer(rotate)

    startBaseSession()
  }

  // ExpoView lays out via layoutSubviews; the hosted ARView must follow bounds
  // or it renders nothing (zero frame).
  override func layoutSubviews() {
    super.layoutSubviews()
    arView.frame = bounds
    if pendingPlacement { tryPlaceModel() }
  }

  // MARK: - Session

  private func startBaseSession() {
    guard ARWorldTrackingConfiguration.isSupported else {
      onError(["message": "ARKit world tracking is not supported on this device"])
      return
    }
    // Enable the LiDAR mesh ONCE so the live occlusion/physics toggles have a
    // feed. meshWithClassification tags faces (floor/wall/…); plain .mesh else.
    if ARWorldTrackingConfiguration.supportsSceneReconstruction(.meshWithClassification) {
      config.sceneReconstruction = .meshWithClassification
      meshSupported = true
    } else if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
      config.sceneReconstruction = .mesh
      meshSupported = true
    }
    config.planeDetection = [.horizontal, .vertical]
    config.environmentTexturing = .automatic
    // Gravity-aligned world (the default — set explicitly to document intent): the
    // world frame stays fixed to the room (never camera-relative) so the anchored
    // model keeps a stable up-axis as the iPad moves.
    config.worldAlignment = .gravity
    // Enable printed-marker DETECTION up front (cheap; a world-tracking feature that
    // coexists with the LiDAR mesh). Marker LOCK is then a pure live toggle — no
    // session re-run — so arming it never hitches the scene.
    configureMarkerDetection()
    arView.session.run(config)
    onTracking(["state": "starting", "lidar": meshSupported])
  }

  // MARK: - Props (called from the Module's Prop closures)

  func setModelUri(_ uri: URL?) { solidUri = uri; reconcileSolid() }
  func setWireframeUri(_ uri: URL?) { wireframeUri = uri; reconcileEdges() }
  func setShowEdges(_ v: Bool) { wantEdges = v; reconcileEdges() }

  // The edge-overlay colour. Re-tints the (opaque) edge tubes in place. No reload.
  func setEdgeColor(_ hex: String) {
    guard let c = Self.colorFromHex(hex) else { return }
    wireframeTint = c
    if let e = edgeEntity { paintUniform(e, wireframeTint, opaque: true) }
  }

  // Per-entity colour overlay for the SOLID model (Color-by Profile/Grade). `map`
  // is entity-name (== ifc_guid) → hex; empty restores the uniform grey. The solid
  // is always shown, so this applies in BOTH view modes (solid, and solid+edges).
  func setColorOverlay(_ map: [String: String]) {
    var parsed: [String: UIColor] = [:]
    parsed.reserveCapacity(map.count)
    for (k, v) in map { if let c = Self.colorFromHex(v) { parsed[k] = c } }
    colorOverlay = parsed
    repaintSolid()
  }

  // See-through overlay: repaint the SOLID at `modelOpacity` (1 = opaque; <1 = a
  // transparent fill so the real assembly shows through). The edge overlay stays
  // opaque, so the outlines stay crisp as the fill fades — the inspection view.
  func setModelOpacity(_ a: Float) {
    modelOpacity = max(0.05, min(1, a))
    repaintSolid()
  }

  // True 1:1 scale (metres-per-GLB-unit). Replaces the fit-scale; re-applies live to
  // an already-placed model (the prop usually arrives after the model is on screen,
  // once the JS calibration completes).
  func setRealScale(_ s: Float) {
    let v = max(0, s)
    if abs(v - realScale) < 1e-9 { return }
    realScale = v
    guard v > 0 else { return }
    if let e = modelEntity { applyRealScale(e) }
    if let e = edgeEntity { applyRealScale(e) }
  }

  // Set the entity's uniform scale to realScale and re-seat its base, keeping it
  // under the same pivot (so placement + the user transform survive).
  private func applyRealScale(_ entity: Entity) {
    guard realScale > 0 else { return }
    let pivot = entity.parent
    entity.scale = SIMD3<Float>(repeating: realScale)
    recenterEntityToBase(entity)        // detaches + re-bases at the new scale
    if let p = pivot { p.addChild(entity) }
  }

  // A flat UnlitMaterial in `color` (no lighting gradient). The SOLID carries the
  // current see-through opacity via the documented blending MULTIPLIER (UnlitMaterial
  // may ignore tint alpha); `opaque` forces full opacity for the edge overlay.
  private func unlitMaterial(_ color: UIColor, opaque: Bool = false) -> UnlitMaterial {
    var mat = UnlitMaterial(color: color)
    if !opaque && modelOpacity < 0.999 {
      mat.blending = .transparent(opacity: .init(floatLiteral: modelOpacity))
    }
    return mat
  }

  // Repaint the SOLID model: per-entity colour overlay if set (Colour-by), else the
  // uniform steel grey — both carrying the see-through opacity. The edge overlay is
  // painted separately (always opaque, in the edge colour).
  private func repaintSolid() {
    guard let entity = modelEntity else { return }
    if colorOverlay.isEmpty {
      paintUniform(entity, solidColor)
    } else {
      paintByOverlay(entity)
    }
  }

  // Paint every mesh with one flat colour (uniform — no lighting gradient).
  private func paintUniform(_ entity: Entity, _ color: UIColor, opaque: Bool = false) {
    let mat = unlitMaterial(color, opaque: opaque)
    func walk(_ e: Entity) {
      if var m = e.components[ModelComponent.self] {
        m.materials = Array(repeating: mat, count: max(m.materials.count, 1))
        e.components.set(m)
      }
      for child in e.children { walk(child) }
    }
    walk(entity)
  }

  // Tint each mesh by its nearest NAMED ancestor's overlay colour (GLTFKit2 names
  // entities by glTF node name == ifc_guid; a ModelComponent may sit on a child of
  // the named node, so we walk up). Unmapped meshes get the neutral ghost grey.
  private func paintByOverlay(_ entity: Entity) {
    func resolve(_ e: Entity) -> UIColor {
      var cur: Entity? = e
      while let c = cur {
        if !c.name.isEmpty, let col = colorOverlay[c.name] { return col }
        cur = c.parent
      }
      return ghostColor
    }
    func walk(_ e: Entity) {
      if var m = e.components[ModelComponent.self] {
        let mat = unlitMaterial(resolve(e))
        m.materials = Array(repeating: mat, count: max(m.materials.count, 1))
        e.components.set(m)
      }
      for child in e.children { walk(child) }
    }
    walk(entity)
  }

  private static func colorFromHex(_ hex: String) -> UIColor? {
    var s = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
    if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
    guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
    return UIColor(
      red: CGFloat((v >> 16) & 0xff) / 255.0,
      green: CGFloat((v >> 8) & 0xff) / 255.0,
      blue: CGFloat(v & 0xff) / 255.0,
      alpha: 1.0
    )
  }

  // Ensure the SOLID model matches solidUri (load/swap only when it changed, so
  // repeated prop applications never thrash the loader).
  private func reconcileSolid() {
    if loadedSolidUri == solidUri && modelEntity != nil { return }
    loadSolid(solidUri)
  }

  // Add / refresh / remove the edge-tube OVERLAY to match (wantEdges, wireframeUri).
  // It's a collision-free child of the pivot, painted opaque in the edge colour,
  // sitting on top of the (always-present) solid. No-op until the solid is placed;
  // the post-placement hook calls this again so a pre-placement toggle still applies.
  private func reconcileEdges() {
    guard wantEdges, let w = wireframeUri, modelPivot != nil else {
      removeEdgeOverlay()
      return
    }
    if loadedEdgeUri == w && edgeEntity != nil { return } // already correct
    loadEdgeOverlay(w)
  }

  private func removeEdgeOverlay() {
    edgeEntity?.removeFromParent()
    edgeEntity = nil
    loadedEdgeUri = nil
  }
  func setOcclusion(_ v: Bool) { wantOcclusion = v; applyFlags() }
  func setPersonSegmentation(_ v: Bool) { wantPeople = v; applyFlags() }
  func setPhysics(_ v: Bool) { wantPhysics = v; applyFlags() }
  func setPlaneAnchor(_ v: Bool) { wantPlaneAnchor = v }
  // Scan-before-place: when true, a freshly loaded model waits for the user to scan
  // the area + tap Place (see placeNow) instead of auto-dropping on load.
  func setManualPlacement(_ v: Bool) { manualPlacement = v }

  func setShowMesh(_ v: Bool) { wantShowMesh = v; applyFlags() }

  func setMeasureMode(_ v: String) {
    guard v != measureMode else { return }
    measureMode = v
    clearMeasurement()
  }
  func setPartPick(_ v: Bool) { partPick = v }
  func setShowOverallBox(_ v: Bool) { showOverallBox = v; rebuildDimensionBoxes() }
  func setShowPartBoxes(_ v: Bool) { showPartBoxes = v; rebuildDimensionBoxes() }

  // MARK: - Mode application (the live switcher core)

  private func applyFlags() {
    // (1) Live ARView toggles — instant, no session.run.
    var opts = arView.environment.sceneUnderstanding.options
    opts.remove([.occlusion, .physics, .collision])
    if meshSupported && wantOcclusion { opts.insert(.occlusion) }
    if meshSupported && wantPhysics { opts.insert([.physics, .collision]) }
    arView.environment.sceneUnderstanding.options = opts

    if wantShowMesh { arView.debugOptions.insert(.showSceneUnderstanding) }
    else { arView.debugOptions.remove(.showSceneUnderstanding) }

    updateModelPhysics()

    // (2) Config layer — people/hand occlusion needs a session re-run. Plain
    // run() with NO reset flags preserves tracking + the placed model.
    let hasPeople = config.frameSemantics.contains(.personSegmentationWithDepth)
    if wantPeople, !hasPeople,
       ARWorldTrackingConfiguration.supportsFrameSemantics(.personSegmentationWithDepth) {
      config.frameSemantics.insert(.personSegmentationWithDepth)
      arView.session.run(config)
    } else if !wantPeople, hasPeople {
      config.frameSemantics.remove(.personSegmentationWithDepth)
      arView.session.run(config)
    }
  }

  private func updateModelPhysics() {
    guard let entity = modelEntity else { return }
    if wantPhysics {
      // Same watchdog guard as the load path — don't convex-hull a huge model.
      guard Self.meshCount(entity, cap: Self.maxCollisionMeshes + 1) <= Self.maxCollisionMeshes else { return }
      entity.generateCollisionShapes(recursive: true)
      entity.components.set(
        PhysicsBodyComponent(
          massProperties: .default,
          material: .generate(friction: 0.5, restitution: 0.0),
          mode: .dynamic
        )
      )
    } else {
      entity.components.remove(PhysicsBodyComponent.self)
    }
  }

  // MARK: - Model loading

  // Above this many meshes, skip the synchronous convex-hull collision pass (it
  // would risk the main-thread watchdog on huge assemblies). Rendering/placement
  // are unaffected; only on-model hit-testing is dropped for such models.
  private static let maxCollisionMeshes = 800

  // Count ModelComponents in a subtree, stopping early once `cap` is reached (so a
  // 1700-mesh model isn't fully walked just to learn it's over the limit).
  private static func meshCount(_ entity: Entity, cap: Int) -> Int {
    var n = 0
    func walk(_ e: Entity) {
      if n >= cap { return }
      if e.components[ModelComponent.self] != nil { n += 1 }
      for c in e.children { if n >= cap { return }; walk(c) }
    }
    walk(entity)
    return n
  }

  private func loadSolid(_ uri: URL?) {
    let token = UUID()
    loadToken = token
    loadedSolidUri = uri

    let place: (Entity) -> Void = { [weak self] entity in
      guard let self, self.loadToken == token else { return }
      // TRUE 1:1 scale (if calibrated) REPLACES the loader's fit-scale — set before
      // recentring/placement so the base sits correctly at the real size.
      if self.realScale > 0 { entity.scale = SIMD3<Float>(repeating: self.realScale) }
      // Collision shapes power on-model ruler hit-tests + part picking (and physics)
      // — the SOLID owns them; the edge overlay stays collision-free so taps fall
      // through to the part underneath. Generate once, recursively, before placement.
      // GUARDED: convex-hull generation is O(meshes) synchronous work on the main
      // actor; on a very large assembly (~1700 meshes) it can block long enough to
      // trip the iOS watchdog. Past a cap we skip it — the model still renders +
      // places; only on-model hit-testing (ruler / part-tap) is unavailable there.
      if Self.meshCount(entity, cap: Self.maxCollisionMeshes + 1) <= Self.maxCollisionMeshes {
        entity.generateCollisionShapes(recursive: true)
      }
      if self.modelPivot != nil {
        // In-place swap (solid reload): keep placement + user transform + overlay.
        self.swapModelEntity(entity)
      } else {
        self.modelEntity = entity
        self.updateModelPhysics()
        if self.manualPlacement {
          // Scan-first: hold the model until the user has mapped the area + taps Place.
          self.awaitingManualPlace = true
          self.pendingPlacement = false
          self.lastScanReady = nil
          self.emitScanState()
        } else {
          self.pendingPlacement = true
          self.placeAttempts = 0
          self.tryPlaceModel()
        }
      }
      self.repaintSolid()    // colour overlay / grey + see-through
      self.reconcileEdges()  // (re)attach the edge overlay if wanted
      self.onLoad(["uri": uri?.absoluteString ?? "placeholder"])
    }

    #if canImport(GLTFKit2)
    if let uri = uri {
      Task { [weak self] in
        do {
          let color = self?.solidColor ?? UIColor.gray
          let entity = try await GltfModelLoader.load(from: uri, unlitColor: color)
          await MainActor.run { place(entity) }
        } catch {
          await MainActor.run {
            self?.onError(["message": "GLB load failed: \(error.localizedDescription)"])
            if self?.modelPivot == nil { place(self?.makePlaceholder() ?? Entity()) }
          }
        }
      }
      return
    }
    #endif
    // No GLTFKit2 linked (or no uri) → placeholder so the LiDAR modes are still
    // demonstrable. Add the GLTFKit2 dependency (README) to load real models.
    if modelPivot == nil { place(makePlaceholder()) }
  }

  // Replace the SOLID entity under the existing pivot WITHOUT re-placing — used on a
  // solid reload (rare). The edge overlay is a separate child of the pivot and is
  // left untouched.
  private func swapModelEntity(_ entity: Entity) {
    guard let pivot = modelPivot else { return }
    if let old = modelEntity { pivot.removeChild(old) }
    recenterEntityToBase(entity)
    pivot.addChild(entity)
    modelEntity = entity
    updateModelPhysics()
    rebuildDimensionBoxes()
  }

  // Load the wireframe GLB as a COLLISION-FREE overlay child of the pivot, aligned
  // to the solid (same base-recenter + matching normalize scale), painted OPAQUE in
  // the edge colour. Guarded by edgeLoadToken so rapid wireframeUri changes (the
  // weight slider) don't race a stale load onto the scene.
  private func loadEdgeOverlay(_ uri: URL) {
    let token = UUID()
    edgeLoadToken = token

    let attach: (Entity) -> Void = { [weak self] entity in
      guard let self, self.edgeLoadToken == token, let pivot = self.modelPivot else { return }
      self.edgeEntity?.removeFromParent()
      // Match the solid's true scale (if calibrated) so the outlines overlay 1:1.
      if self.realScale > 0 { entity.scale = SIMD3<Float>(repeating: self.realScale) }
      self.recenterEntityToBase(entity)
      self.paintUniform(entity, self.wireframeTint, opaque: true)
      // NO generateCollisionShapes → taps/measure/part-pick reach the solid beneath.
      pivot.addChild(entity)
      self.edgeEntity = entity
      self.loadedEdgeUri = uri
    }

    #if canImport(GLTFKit2)
    Task { [weak self] in
      guard let self else { return }
      do {
        let entity = try await GltfModelLoader.load(from: uri, unlitColor: self.wireframeTint)
        await MainActor.run { attach(entity) }
      } catch {
        await MainActor.run { self.onError(["message": "Edge overlay load failed: \(error.localizedDescription)"]) }
      }
    }
    #endif
  }

  // Steel-grey box (~beam-ish) used until GLTFKit2 + a real model are wired in.
  private func makePlaceholder() -> ModelEntity {
    let mesh = MeshResource.generateBox(size: [0.4, 0.2, 0.6], cornerRadius: 0.01)
    let mat = SimpleMaterial(
      color: UIColor(red: 0.67, green: 0.70, blue: 0.74, alpha: 1.0),
      isMetallic: true
    )
    let e = ModelEntity(mesh: mesh, materials: [mat])
    e.scale = SIMD3<Float>(repeating: 1)
    return e
  }

  // MARK: - Placement (native LiDAR raycast onto the real surface)

  // Position an entity so its horizontal centre is at the local origin and its
  // BASE rests at y=0 (so it sits ON the surface and yaw spins it in place).
  // Bounds are read in the entity's OWN space — detached from any parent and with
  // position zeroed first — so an ancestor anchor/pivot transform or a prior
  // centring offset can never contaminate the result (it's fully idempotent).
  private func recenterEntityToBase(_ entity: Entity) {
    entity.removeFromParent()
    entity.position = .zero
    let b = entity.visualBounds(relativeTo: nil)
    if b.extents.x.isFinite && b.extents.y.isFinite {
      entity.position = SIMD3<Float>(-b.center.x, -b.center.y + b.extents.y / 2, -b.center.z)
    }
  }

  // Create a SESSION-TRACKED anchor at `worldTransform`: a real ARAnchor added to the
  // ARKit session, wrapped by an AnchorEntity tied to it. When ARKit refines its world
  // map (loop closure / interruption recovery / a restored map) it updates the
  // ARAnchor's transform and RealityKit rides that onto the AnchorEntity — corrections
  // a static AnchorEntity(world:) never gets. This is the correct primitive for a
  // placed model; it does NOT eliminate the continuous walk-induced VIO drift on a
  // large piece (use auto-snap / registration at the far end for that). The backing
  // ARAnchor is returned so the caller can track it for teardown.
  private func makeTrackedAnchor(_ worldTransform: simd_float4x4) -> (AnchorEntity, ARAnchor) {
    let ar = ARAnchor(transform: worldTransform)
    arView.session.add(anchor: ar)
    return (AnchorEntity(anchor: ar), ar)
  }

  // Detach + remove the current model anchor from BOTH the RealityKit scene and the
  // ARKit session (a tracked ARAnchor must be removed from the session too, or it
  // lingers and keeps getting relocalization updates).
  private func teardownModelAnchor() {
    if let a = modelAnchor { arView.scene.removeAnchor(a) }
    if let ar = modelArAnchor { arView.session.remove(anchor: ar) }
    modelAnchor = nil
    modelArAnchor = nil
  }

  // Anchor the model at `worldTransform`, inserting the user-transform pivot.
  private func placeOn(_ worldTransform: simd_float4x4, onSurface: Bool) {
    guard let entity = modelEntity else { return }
    // Remove the old anchor BEFORE recentring (recenter detaches the entity too,
    // but this also tears down the stale pivot so nothing dangles in the scene).
    teardownModelAnchor()
    recenterEntityToBase(entity)

    let pivot = Entity()
    pivot.addChild(entity)
    // Re-attach the edge overlay (orphaned when the old pivot was torn down) to the
    // new pivot, so it survives re-placement (recenter / reset) without a reload.
    if let edge = edgeEntity {
      edge.removeFromParent()
      recenterEntityToBase(edge)
      pivot.addChild(edge)
    }
    let (anchor, ar) = makeTrackedAnchor(worldTransform)
    let correction = Entity()        // identity at placement; holds smoothed ICP deltas
    correction.addChild(pivot)
    anchor.addChild(correction)
    arView.scene.addAnchor(anchor)
    modelPivot = pivot
    modelCorrection = correction
    modelAnchor = anchor
    modelArAnchor = ar
    applyUserTransform()
    // Post-placement hook: now that the pivot exists, (re)build the edge overlay so
    // an edge view requested BEFORE placement (the scan-first flow / edges-on default)
    // actually attaches. reconcileEdges() no-ops if the overlay is already correct.
    reconcileEdges()
    rebuildDimensionBoxes()
    pendingPlacement = false
    placeAttempts = 0
    onAnchor(["placed": true, "onSurface": onSurface])
  }

  private func tryPlaceModel() {
    guard pendingPlacement, modelEntity != nil,
          bounds.width > 0, bounds.height > 0 else { return }

    // PREFER a real surface under the reticle (LiDAR mesh / estimated plane) so
    // the model lands on the floor/desk in front of you — never buried in a wall.
    let center = CGPoint(x: bounds.midX, y: bounds.midY)
    if let r = arView.raycast(from: center, allowing: .estimatedPlane, alignment: .any).first {
      placeOn(r.worldTransform, onSurface: true)
      return
    }
    // No surface yet — keep retrying for a beat while the LiDAR scans, then drop
    // it CLOSE (0.6 m) and slightly DOWN so it stays in view and out of any wall.
    placeAttempts += 1
    if placeAttempts >= 45 {
      let cam = arView.cameraTransform
      let m = cam.matrix
      // Offset direction follows the camera's gaze (flattened so a downward tilt
      // doesn't bury the model), but the model is seated GRAVITY-UP (identity
      // rotation) — never the camera's tilt, which used to drop it askew and force
      // manual pitch/roll cleanup. The surface-hit branch above keeps the real
      // surface normal; only this fallback is leveled.
      var fwd = SIMD3<Float>(-m.columns.2.x, 0, -m.columns.2.z)
      fwd = simd_length(fwd) > 1e-4 ? simd_normalize(fwd)
                                    : SIMD3<Float>(-m.columns.2.x, -m.columns.2.y, -m.columns.2.z)
      let pos = cam.translation + fwd * 0.6 - SIMD3<Float>(0, 0.15, 0)
      var t = matrix_identity_float4x4
      t.columns.3 = SIMD4<Float>(pos.x, pos.y, pos.z, 1)
      placeOn(t, onSurface: false)
    }
  }

  // MARK: - Scan-before-place gate

  // Is there a REAL (LiDAR-/feature-mapped) surface under the reticle right now? This
  // is the "the area is understood here" signal — it only succeeds once ARKit has an
  // actual plane (existingPlaneGeometry), not a fleeting estimate.
  private func reticleHasRealSurface() -> Bool {
    guard bounds.width > 0, bounds.height > 0 else { return false }
    let c = CGPoint(x: bounds.midX, y: bounds.midY)
    return arView.raycast(from: c, allowing: .existingPlaneGeometry, alignment: .any).first != nil
  }

  // Tell JS whether the scene is mapped enough to place (normal tracking + a real
  // surface at the reticle). Emitted only on change while awaiting placement, so the
  // session-update firehose doesn't spam the bridge.
  private func emitScanState() {
    guard awaitingManualPlace else { return }
    let ready = (lastTrackingState == "normal") && reticleHasRealSurface()
    if ready == lastScanReady { return }
    lastScanReady = ready
    onScanState(["ready": ready, "tracking": lastTrackingState])
  }

  // The "Place model" action (scan-first mode). Anchors the model at the reticle onto
  // the best available surface — a real mapped plane first (the payoff of scanning),
  // falling back to an infinite plane then an estimate so it can never dead-end.
  func placeNow() {
    guard awaitingManualPlace, modelEntity != nil, bounds.width > 0, bounds.height > 0 else { return }
    let c = CGPoint(x: bounds.midX, y: bounds.midY)
    let hit = arView.raycast(from: c, allowing: .existingPlaneGeometry, alignment: .any).first
      ?? arView.raycast(from: c, allowing: .existingPlaneInfinite, alignment: .any).first
      ?? arView.raycast(from: c, allowing: .estimatedPlane, alignment: .any).first
    guard let r = hit else {
      onScanState(["ready": false, "tracking": lastTrackingState, "reason": "no-surface"])
      return
    }
    awaitingManualPlace = false
    lastScanReady = nil
    placeOn(r.worldTransform, onSurface: true)
  }

  // MARK: - Align (user transform on the pivot)

  private func applyUserTransform() {
    guard let pivot = modelPivot else { return }
    pivot.transform = Transform(
      scale: SIMD3<Float>(repeating: userScale),
      rotation: userOrientation,
      translation: userTranslate
    )
  }

  // Screen-relative move (the Align panel's MOVE buttons). The deltas are intent
  // in the INSPECTOR'S view, not raw anchor axes:
  //   dx = +Right (screen), dy = +Up (WORLD), dz = +Near (toward the camera).
  // We map them onto world directions from the live camera pose — Left/Right along
  // the camera's horizontal right axis, Near/Far toward/away from the viewer, Up/Down
  // along world-up — then convert that world delta into anchor-local space for the
  // pivot. The old version added the delta directly to anchor-LOCAL userTranslate,
  // so on a rotated anchor (arbitrary heading) or a tilted surface the buttons moved
  // the model in directions that didn't match their labels / the screen.
  func nudge(_ dx: Float, _ dy: Float, _ dz: Float) {
    guard !locked, let correction = modelCorrection, modelPivot != nil else { return }
    let m = arView.cameraTransform.matrix
    // Camera basis in world space: column 0 = right, column 2 = backward (toward the
    // viewer, since the camera looks down its own −Z). Flatten the horizontal axes to
    // the world ground plane so a move never sneaks in a height change.
    func flatNorm(_ v: SIMD3<Float>) -> SIMD3<Float> {
      let f = SIMD3<Float>(v.x, 0, v.z)
      let len = simd_length(f)
      return len > 1e-4 ? f / len : SIMD3<Float>(repeating: 0)
    }
    let right = flatNorm(SIMD3<Float>(m.columns.0.x, m.columns.0.y, m.columns.0.z))
    let towardViewer = flatNorm(SIMD3<Float>(m.columns.2.x, m.columns.2.y, m.columns.2.z))
    let worldDelta = right * dx + SIMD3<Float>(0, dy, 0) + towardViewer * dz
    // Convert the world delta into the pivot's PARENT frame (the correction node), since
    // userTranslate is the pivot's local translation under modelCorrection.
    userTranslate += correction.convert(direction: worldDelta, from: nil)
    applyUserTransform()
  }

  // Nudge along WORLD axes (the elevation handle wants true world-up, not the
  // anchor's local Y which is the surface normal on a tilted/vertical anchor).
  func nudgeWorld(_ dx: Float, _ dy: Float, _ dz: Float) {
    guard !locked, let correction = modelCorrection, modelPivot != nil else { return }
    userTranslate += correction.convert(direction: SIMD3<Float>(dx, dy, dz), from: nil)
    applyUserTransform()
  }

  func rotate(_ dPitchDeg: Float, _ dYawDeg: Float, _ dRollDeg: Float) {
    guard !locked, modelPivot != nil else { return }
    let r = Float.pi / 180
    // Compose each nudge as a rotation about a FIXED WORLD axis (pre-multiply onto
    // the current orientation): Turn → world-up (Y), Tilt → world-X, Roll → world-Z.
    // The axes never coincide, so there's no gimbal lock — turn/tilt/roll stay
    // independent and predictable at any orientation.
    var q = userOrientation
    if dYawDeg != 0 { q = simd_quatf(angle: dYawDeg * r, axis: SIMD3<Float>(0, 1, 0)) * q }
    if dPitchDeg != 0 { q = simd_quatf(angle: dPitchDeg * r, axis: SIMD3<Float>(1, 0, 0)) * q }
    if dRollDeg != 0 { q = simd_quatf(angle: dRollDeg * r, axis: SIMD3<Float>(0, 0, 1)) * q }
    userOrientation = simd_normalize(q)
    applyUserTransform()
  }

  func scaleBy(_ factor: Float) {
    guard !locked, modelPivot != nil, factor > 0 else { return }
    userScale = min(20, max(0.05, userScale * factor))
    applyUserTransform()
  }

  func setLocked(_ v: Bool) { locked = v }

  // Reset the user transform and re-acquire a surface in front of the camera.
  func recenter() {
    userScale = 1; userOrientation = simd_quatf(angle: 0, axis: SIMD3<Float>(0, 1, 0))
    userTranslate = SIMD3<Float>(repeating: 0)
    clearRegistration() // the model moves → any captured pairs are stale
    markerBindings.removeAll(); activeMarkerName = nil // marker offsets are stale too
    guard let entity = modelEntity else { return }
    teardownModelAnchor()
    modelPivot = nil
    modelCorrection = nil
    // Re-parent a fresh entity reference is unnecessary; re-place the same one.
    entity.removeFromParent()
    pendingPlacement = true
    placeAttempts = 0
    tryPlaceModel()
  }

  // MARK: - Direct manipulation (drag-to-move on the surface, twist-for-yaw)

  func setDirectManipulation(_ v: Bool) {
    directManipulation = v
    if !v { panOnModel = false }
  }

  // One-finger drag: if it begins ON the model, slide the model in the WORLD
  // horizontal plane at the model's current height, keeping the grabbed point
  // pinned under the finger. Working in WORLD space (not anchor-local x/z) makes
  // the drag correct regardless of the anchor's orientation, never depends on a
  // detected plane (so it can't freeze on mesh-only surfaces), and can't be flung
  // onto a far wall behind the model. Height changes only via the elevation
  // handle. A drag that begins off the model is ignored, so tap / measure /
  // part-pick stay untouched.
  @objc private func handlePan(_ g: UIPanGestureRecognizer) {
    guard directManipulation, !locked, let correction = modelCorrection, let pivot = modelPivot,
          measureMode == "off", registerMode == "off", !partPick else { return }
    let p = g.location(in: arView)
    switch g.state {
    case .began:
      panOnModel = arView.hitTest(p, query: .nearest, mask: .all).first != nil
      guard panOnModel else { return }
      // Drag plane = a world-horizontal plane through the model's current base;
      // the grab offset keeps whatever point you grabbed under the finger (no
      // teleport of the base-centre on the first move).
      let pivotWorld = pivot.position(relativeTo: nil)
      dragPlaneY = pivotWorld.y
      if let grab = rayHitOnHorizontalPlane(p, y: dragPlaneY) {
        dragGrabOffset = SIMD2<Float>(pivotWorld.x - grab.x, pivotWorld.z - grab.z)
      } else {
        dragGrabOffset = SIMD2<Float>(0, 0)
      }
      dragHaptics.impactOccurred()
    case .changed:
      guard panOnModel, let hit = rayHitOnHorizontalPlane(p, y: dragPlaneY) else { return }
      // Pivot-origin target = finger-on-plane + grab offset, at the fixed drag
      // height; convert that WORLD point to anchor-local for the pivot translation
      // (all three components, so the world height is preserved on any anchor tilt).
      let targetWorld = SIMD3<Float>(hit.x + dragGrabOffset.x, dragPlaneY, hit.z + dragGrabOffset.y)
      userTranslate = correction.convert(position: targetWorld, from: nil)
      applyUserTransform()
    default:
      panOnModel = false
    }
  }

  // Intersect the screen ray with a world-horizontal plane at height `y`.
  private func rayHitOnHorizontalPlane(_ screen: CGPoint, y: Float) -> SIMD3<Float>? {
    guard let ray = arView.ray(through: screen) else { return nil }
    let dirY = ray.direction.y
    guard abs(dirY) > 1e-5 else { return nil }       // ray ~parallel to the plane
    let t = (y - ray.origin.y) / dirY
    guard t > 0 else { return nil }                  // plane is behind the camera
    return ray.origin + ray.direction * t
  }

  // Two-finger twist → yaw the model in place about world-up. Apply the gesture
  // delta INCREMENTALLY onto userOrientation (about world Y), re-baselining each
  // frame, so it composes with the quaternion orientation without a first-move jump.
  @objc private func handleRotate(_ g: UIRotationGestureRecognizer) {
    guard directManipulation, !locked, modelPivot != nil,
          measureMode == "off", registerMode == "off", !partPick else { return }
    switch g.state {
    case .began:
      rotateBaselineRotation = Float(g.rotation)
      panOnModel = false                             // a 2nd finger ends the 1-finger drag
    case .changed:
      let delta = -(Float(g.rotation) - rotateBaselineRotation) // clockwise twist → yaw right
      rotateBaselineRotation = Float(g.rotation)
      userOrientation = simd_normalize(simd_quatf(angle: delta, axis: SIMD3<Float>(0, 1, 0)) * userOrientation)
      applyUserTransform()
    default:
      break
    }
  }

  // Let tap / pan / rotate coexist (a tap still fires for a no-movement touch;
  // pan begins on movement; rotate is two-finger).
  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                         shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
    return true
  }

  // MARK: - Measurement

  private func ensureMeasureAnchor() -> AnchorEntity {
    if let a = measureAnchor { return a }
    let a = AnchorEntity(world: matrix_identity_float4x4)
    arView.scene.addAnchor(a)
    measureAnchor = a
    return a
  }

  // Capture a measurement point at a screen location (a tap, or the reticle for
  // the Place-point button). The ray used depends on the active tool and which
  // point we're on (deviation: 1st on the model, 2nd in the real world).
  func captureMeasurePoint(at screenPoint: CGPoint) {
    guard measureMode != "off" else { return }
    let index = measurePoints.count >= 2 ? 0 : measurePoints.count  // 3rd tap restarts
    let useModelHit: Bool
    switch measureMode {
    case "model": useModelHit = true
    case "real": useModelHit = false
    case "deviation": useModelHit = (index == 0)
    default: return
    }

    var world: SIMD3<Float>?
    if useModelHit {
      if let hit = arView.hitTest(screenPoint, query: .nearest, mask: .all).first {
        world = hit.position
      }
    } else {
      if let r = arView.raycast(from: screenPoint, allowing: .estimatedPlane, alignment: .any).first {
        world = simd_make_float3(r.worldTransform.columns.3)
      }
    }
    guard let p = world else {
      onMeasure(["kind": measureMode, "miss": true, "points": pointsPayload(), "renderScale": renderScale()])
      return
    }

    // A 3rd capture RESTARTS the pair: clear BOTH the geometry and the point
    // buffer (clearing only the geometry would let the array grow to 3+, so the
    // count==2 line never redraws and deviation's model/real indices desync).
    if measurePoints.count >= 2 {
      clearMeasurementGeometry()
      measurePoints.removeAll()
    }
    measurePoints.append(p)
    addMarker(p)
    if measurePoints.count == 2 { drawMeasureLine() }
    onMeasure(["kind": measureMode, "points": pointsPayload(), "renderScale": renderScale()])
  }

  // Capture at the screen centre (the JS reticle + "Place point" button) — the
  // precise path for real-world / deviation points where aiming beats tapping.
  func captureAtReticle() {
    captureMeasurePoint(at: CGPoint(x: bounds.midX, y: bounds.midY))
  }

  // The model's total render scale = its (uniform) normalize scale × userScale.
  // Dividing an on-MODEL world distance by this recovers the true GLB-unit size.
  private func renderScale() -> Float { (modelEntity?.scale.x ?? 1) * userScale }

  private func pointsPayload() -> [[Float]] {
    return measurePoints.map { [$0.x, $0.y, $0.z] }
  }

  private func addMarker(_ p: SIMD3<Float>) {
    let mesh = MeshResource.generateSphere(radius: 0.008)
    let mat = UnlitMaterial(color: UIColor(red: 0.04, green: 0.65, blue: 0.92, alpha: 1.0))
    let marker = ModelEntity(mesh: mesh, materials: [mat])
    marker.position = p
    ensureMeasureAnchor().addChild(marker)
    measureMarkers.append(marker)
  }

  private func drawMeasureLine() {
    guard measurePoints.count == 2 else { return }
    measureLine?.removeFromParent()
    let a = measurePoints[0], b = measurePoints[1]
    let len = simd_distance(a, b)
    guard len > 0.0001 else { return }
    let mesh = MeshResource.generateBox(size: SIMD3<Float>(0.004, 0.004, len))
    let mat = UnlitMaterial(color: UIColor(red: 1.0, green: 0.85, blue: 0.10, alpha: 1.0))
    let line = ModelEntity(mesh: mesh, materials: [mat])
    line.position = (a + b) / 2
    let dir = simd_normalize(b - a)
    // simd_quatf(from:to:) is undefined when the vectors are anti-parallel (zero
    // rotation axis → NaN). Guard the exact-opposite case with a fixed 180° flip.
    let zAxis = SIMD3<Float>(0, 0, 1)
    if simd_dot(zAxis, dir) < -0.9999 {
      line.orientation = simd_quatf(angle: .pi, axis: SIMD3<Float>(0, 1, 0))
    } else {
      line.orientation = simd_quatf(from: zAxis, to: dir)
    }
    ensureMeasureAnchor().addChild(line)
    measureLine = line
  }

  private func clearMeasurementGeometry() {
    for m in measureMarkers { m.removeFromParent() }
    measureMarkers.removeAll()
    measureLine?.removeFromParent()
    measureLine = nil
  }

  func clearMeasurement() {
    measurePoints.removeAll()
    clearMeasurementGeometry()
    onMeasure(["kind": measureMode, "points": [[Float]](), "renderScale": renderScale()])
  }

  // MARK: - Point-pair registration (tap a model corner, then the same real corner)

  func setRegisterMode(_ v: String) { registerMode = v }

  private func ensureRegisterAnchor() -> AnchorEntity {
    if let a = registerAnchor { return a }
    let a = AnchorEntity(world: matrix_identity_float4x4)
    arView.scene.addAnchor(a)
    registerAnchor = a
    return a
  }

  // Capture one point. "model" → hit-test the model (world point at the current
  // pose); "real" → raycast the real surface. JS pairs them and solves the fit.
  func captureRegisterPoint(at p: CGPoint) {
    guard registerMode != "off" else { return }
    // Role is decided by the native buffer PARITY (authoritative), not the async JS
    // prop — otherwise two fast taps could both capture as the same side before the
    // prop round-trips. A dangling model point ⇒ the next capture is its real match.
    let expectingReal = registerModelPoints.count > registerRealPoints.count
    if expectingReal {
      guard let r = arView.raycast(from: p, allowing: .estimatedPlane, alignment: .any).first else {
        onRegisterPoint(["space": "real", "miss": true]); return
      }
      let w = simd_make_float3(r.worldTransform.columns.3)
      registerRealPoints.append(w)
      addRegisterMarker(w, isModel: false)
      drawRegisterLine(registerModelPoints[registerRealPoints.count - 1], w)
      onRegisterPoint(["space": "real", "point": [w.x, w.y, w.z]])
    } else {
      guard let hit = arView.hitTest(p, query: .nearest, mask: .all).first else {
        onRegisterPoint(["space": "model", "miss": true]); return
      }
      registerModelPoints.append(hit.position)
      addRegisterMarker(hit.position, isModel: true)
      onRegisterPoint(["space": "model",
                       "point": [hit.position.x, hit.position.y, hit.position.z],
                       "name": hit.entity.name])
    }
  }

  func captureRegisterAtReticle() {
    captureRegisterPoint(at: CGPoint(x: bounds.midX, y: bounds.midY))
  }

  private func addRegisterMarker(_ p: SIMD3<Float>, isModel: Bool) {
    let color = isModel ? UIColor(red: 1.0, green: 0.6, blue: 0.0, alpha: 1.0)    // model = orange
                        : UIColor(red: 0.12, green: 0.85, blue: 0.4, alpha: 1.0)  // real = green
    let marker = ModelEntity(mesh: MeshResource.generateSphere(radius: 0.01),
                             materials: [UnlitMaterial(color: color)])
    marker.position = p
    ensureRegisterAnchor().addChild(marker)
    registerMarkers.append(marker)
  }

  // A thin white connector between a model point and its real match (the
  // correction this pair contributes). Reuses the anti-parallel quat guard.
  private func drawRegisterLine(_ a: SIMD3<Float>, _ b: SIMD3<Float>) {
    let d = simd_distance(a, b)
    guard d > 0.0005 else { return }
    let line = ModelEntity(mesh: MeshResource.generateBox(size: SIMD3<Float>(0.003, 0.003, d)),
                           materials: [UnlitMaterial(color: UIColor(white: 1.0, alpha: 0.9))])
    line.position = (a + b) / 2
    let dir = simd_normalize(b - a)
    let zAxis = SIMD3<Float>(0, 0, 1)
    if simd_dot(zAxis, dir) < -0.9999 {
      line.orientation = simd_quatf(angle: .pi, axis: SIMD3<Float>(0, 1, 0))
    } else {
      line.orientation = simd_quatf(from: zAxis, to: dir)
    }
    ensureRegisterAnchor().addChild(line)
    registerMarkers.append(line)
  }

  private func rebuildRegisterMarkers() {
    for m in registerMarkers { m.removeFromParent() }
    registerMarkers.removeAll()
    for p in registerModelPoints { addRegisterMarker(p, isModel: true) }
    for p in registerRealPoints { addRegisterMarker(p, isModel: false) }
    let pairs = min(registerModelPoints.count, registerRealPoints.count)
    for i in 0..<pairs { drawRegisterLine(registerModelPoints[i], registerRealPoints[i]) }
  }

  // Undo the most recent capture. A half-finished pair drops just its dangling
  // model point; a completed pair drops BOTH halves — so the native buffers stay
  // in lock-step with the JS pair list (which drops the whole pair).
  func undoRegisterPair() {
    if registerModelPoints.count > registerRealPoints.count {
      registerModelPoints.removeLast()
    } else if !registerRealPoints.isEmpty {
      registerRealPoints.removeLast()
      registerModelPoints.removeLast()
    }
    rebuildRegisterMarkers()
  }

  func clearRegistration() {
    registerModelPoints.removeAll()
    registerRealPoints.removeAll()
    rebuildRegisterMarkers()
  }

  // Apply a world-space correction T (newModelWorld = T · oldModelWorld) onto the
  // CORRECTION NODE instead of re-seating the ARAnchor — so the long-lived anchor keeps
  // its relocalization continuity. The correction lives in the anchor's local frame:
  // correctionNew = anchorWorld⁻¹ · T · anchorWorld · correctionOld. Used by point-pair
  // registration and the manual one-shot Auto-snap button (both instant, full corrections).
  private func applyWorldCorrection(_ tfix: simd_float4x4) {
    guard let anchor = modelAnchor, let correction = modelCorrection else { return }
    let anchorWorld = anchor.transformMatrix(relativeTo: nil)
    let targetMat = anchorWorld.inverse * tfix * anchorWorld * correction.transform.matrix
    correction.transform = Transform(matrix: targetMat)
    onAnchor(["placed": true, "onSurface": true])
  }

  // Bake the JS-solved rigid transform (column-major 4×4) onto the anchor. Scale
  // is never part of T_fix (rigid only).
  func applyRegistration(_ m: [Double]) {
    guard m.count == 16 else { return }
    let f = m.map { Float($0) }
    let tfix = simd_float4x4(
      SIMD4<Float>(f[0], f[1], f[2], f[3]),
      SIMD4<Float>(f[4], f[5], f[6], f[7]),
      SIMD4<Float>(f[8], f[9], f[10], f[11]),
      SIMD4<Float>(f[12], f[13], f[14], f[15])
    )
    applyWorldCorrection(tfix)
    clearRegistration()
  }

  // MARK: - ICP auto-snap (refine the pose onto the scanned LiDAR mesh)

  // One-tap refinement (the manual "Auto-snap" button): pull the real LiDAR mesh near
  // the model, run point-to-plane ICP seeded from the CURRENT (already roughly-aligned)
  // pose, and apply the correction ONLY if it lowers the residual — otherwise revert +
  // report why, so it can never make alignment worse. Model + real-mesh points are
  // gathered on the main thread, ICP solves off-main, the apply/revert is back on main.
  func autoAlign() {
    guard meshSupported else { onAutoAlign(["ok": false, "reason": "no-lidar"]); return }
    guard !locked else { onAutoAlign(["ok": false, "reason": "locked"]); return }
    guard modelEntity != nil, modelPivot != nil, modelAnchor != nil else {
      onAutoAlign(["ok": false, "reason": "not-placed"]); return
    }
    let model = gatherModelPointsWorld(cap: 600)
    guard model.count >= 20 else {
      onAutoAlign(["ok": false, "reason": "no-model-geometry"]); return
    }

    var lo = model[0], hi = model[0]
    for p in model { lo = simd_min(lo, p); hi = simd_max(hi, p) }
    let margin = SIMD3<Float>(repeating: 0.3)
    let (real, normals) = gatherRealMeshWorld(aabbMin: lo - margin, aabbMax: hi + margin, cap: 4000)
    guard real.count >= 80 else {
      onAutoAlign(["ok": false, "reason": "sparse-mesh"]); return
    }

    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      let res = IcpAligner.solve(modelPoints: model, realPoints: real, realNormals: normals)
      DispatchQueue.main.async {
        guard let self else { return }
        self.handleSnapResult(res)
      }
    }
  }

  private func handleSnapResult(_ res: IcpAligner.Result) {
    let inlierFloor: Float = 0.3
    let rmsMargin: Float = 0.0005
    let improved = res.finalRmsM.isFinite
      && res.finalRmsM < res.initialRmsM - rmsMargin
      && res.inlierRatio >= inlierFloor

    guard improved else {
      let reason = res.inlierRatio < inlierFloor ? "low-overlap" : "no-improvement"
      onAutoAlign(["ok": false, "reason": reason,
                   "rmsMm": res.finalRmsM.isFinite ? res.finalRmsM * 1000 : 0,
                   "inlierRatio": res.inlierRatio])
      return
    }

    applyWorldCorrection(res.transform)
    onAutoAlign([
      "ok": true,
      "rmsMm": res.finalRmsM * 1000,
      "fromMm": res.initialRmsM * 1000,
      "inlierRatio": res.inlierRatio,
      "iterations": res.iterations,
    ])
  }

  // Sample the model's mesh vertices in WORLD space (subsampled + capped) for the ICP
  // auto-snap. Walks every ModelComponent's vertex buffer; this runs only on the manual
  // Auto-snap button (not per frame), so it isn't cached.
  private func gatherModelPointsWorld(cap: Int) -> [SIMD3<Float>] {
    guard let model = modelEntity else { return [] }
    var pts: [SIMD3<Float>] = []
    func walk(_ e: Entity) {
      if let mc = e.components[ModelComponent.self] {
        let toWorld = e.transformMatrix(relativeTo: nil)
        let positions = mc.mesh.contents.models.flatMap { $0.parts }.flatMap { Array($0.positions) }
        let step = max(1, positions.count / 200)
        var i = 0
        while i < positions.count {
          let v = toWorld * SIMD4<Float>(positions[i], 1)
          pts.append(SIMD3<Float>(v.x, v.y, v.z))
          i += step
        }
      }
      for c in e.children { walk(c) }
    }
    walk(model)
    return subsample(pts, cap: cap)
  }

  // Gather real-mesh vertices + normals (WORLD space) inside the model AABB.
  private func gatherRealMeshWorld(aabbMin: SIMD3<Float>, aabbMax: SIMD3<Float>, cap: Int)
    -> ([SIMD3<Float>], [SIMD3<Float>]) {
    guard let frame = arView.session.currentFrame else { return ([], []) }
    var pts: [SIMD3<Float>] = []
    var nors: [SIMD3<Float>] = []
    for case let ma as ARMeshAnchor in frame.anchors {
      let geom = ma.geometry
      let vsrc = geom.vertices
      let nsrc = geom.normals
      let xform = ma.transform
      let count = vsrc.count
      guard count > 0, nsrc.count == count else { continue }
      let step = max(1, count / 400)
      var i = 0
      while i < count {
        let lv = readVec3(vsrc, i)
        let wv = xform * SIMD4<Float>(lv, 1)
        if wv.x >= aabbMin.x, wv.x <= aabbMax.x,
           wv.y >= aabbMin.y, wv.y <= aabbMax.y,
           wv.z >= aabbMin.z, wv.z <= aabbMax.z {
          let ln = readVec3(nsrc, i)
          let wn = xform * SIMD4<Float>(ln, 0)
          var n = SIMD3<Float>(wn.x, wn.y, wn.z)
          let l = simd_length(n)
          n = l > 1e-5 ? n / l : SIMD3<Float>(0, 1, 0)
          pts.append(SIMD3<Float>(wv.x, wv.y, wv.z))
          nors.append(n)
        }
        i += step
      }
    }
    if pts.count > cap {
      let s = pts.count / cap
      var rp: [SIMD3<Float>] = []
      var rn: [SIMD3<Float>] = []
      var i = 0
      while i < pts.count { rp.append(pts[i]); rn.append(nors[i]); i += s }
      return (rp, rn)
    }
    return (pts, nors)
  }

  private func subsample(_ pts: [SIMD3<Float>], cap: Int) -> [SIMD3<Float>] {
    guard pts.count > cap, cap > 0 else { return pts }
    let s = pts.count / cap
    var out: [SIMD3<Float>] = []
    var i = 0
    while i < pts.count { out.append(pts[i]); i += s }
    return out
  }

  // ARKit packs vertices/normals as tightly-strided float3 — read via a (Float,
  // Float, Float) tuple (12 B, no SIMD alignment padding) at the source's stride.
  private func readVec3(_ src: ARGeometrySource, _ index: Int) -> SIMD3<Float> {
    let p = src.buffer.contents().advanced(by: src.offset + src.stride * index)
    let t = p.assumingMemoryBound(to: (Float, Float, Float).self).pointee
    return SIMD3<Float>(t.0, t.1, t.2)
  }

  // MARK: - Part picking

  private func pickPart(at screenPoint: CGPoint) {
    guard let hit = arView.hitTest(screenPoint, query: .nearest, mask: .all).first else { return }
    var e: Entity? = hit.entity
    var name = hit.entity.name
    // Walk up to the nearest non-empty, non-pivot name (GLTFKit2 names entities
    // by glTF node name == ifc_guid).
    while let cur = e, name.isEmpty { name = cur.name; e = cur.parent }
    onPartTap(["name": name, "world": [hit.position.x, hit.position.y, hit.position.z]])
  }

  // MARK: - Dimensions (wireframe bounding boxes under the pivot)

  private func rebuildDimensionBoxes() {
    dimsContainer?.removeFromParent()
    dimsContainer = nil
    guard let pivot = modelPivot, let model = modelEntity,
          (showOverallBox || showPartBoxes) else { return }

    let container = Entity()
    pivot.addChild(container)
    dimsContainer = container

    if showOverallBox {
      let b = model.visualBounds(relativeTo: pivot)
      if b.extents.x.isFinite {
        container.addChild(makeWireBox(center: b.center, extents: b.extents,
                                       color: UIColor(red: 0.0, green: 0.9, blue: 1.0, alpha: 1.0)))
      }
    }
    if showPartBoxes {
      var count = 0
      func walk(_ e: Entity) {
        if count >= 80 { return }
        if e.components[ModelComponent.self] != nil, e !== model {
          let b = e.visualBounds(relativeTo: pivot)
          if b.extents.x.isFinite && b.extents.x > 0 {
            container.addChild(makeWireBox(center: b.center, extents: b.extents,
                                           color: UIColor(red: 0.22, green: 1.0, blue: 0.30, alpha: 0.9)))
            count += 1
          }
        }
        for c in e.children { walk(c) }
      }
      walk(model)
    }
  }

  // 12 thin edge boxes forming a wireframe AABB (RealityKit has no wireframe
  // material, so edges are slim boxes).
  private func makeWireBox(center: SIMD3<Float>, extents: SIMD3<Float>, color: UIColor) -> Entity {
    let group = Entity()
    let t: Float = max(0.0015, min(extents.x, min(extents.y, extents.z)) * 0.02)
    let mat = UnlitMaterial(color: color)
    let hx = extents.x / 2, hy = extents.y / 2, hz = extents.z / 2

    func edge(_ size: SIMD3<Float>, _ pos: SIMD3<Float>) {
      let m = MeshResource.generateBox(size: size)
      let e = ModelEntity(mesh: m, materials: [mat])
      e.position = center + pos
      group.addChild(e)
    }
    // 4 edges along X
    for sy in [-hy, hy] { for sz in [-hz, hz] { edge([extents.x, t, t], [0, sy, sz]) } }
    // 4 edges along Y
    for sx in [-hx, hx] { for sz in [-hz, hz] { edge([t, extents.y, t], [sx, 0, sz]) } }
    // 4 edges along Z
    for sx in [-hx, hx] { for sy in [-hy, hy] { edge([t, t, extents.z], [sx, sy, 0]) } }
    return group
  }

  // MARK: - Tap routing

  @objc private func handleTap(_ g: UITapGestureRecognizer) {
    let point = g.location(in: arView)
    if measureMode != "off" { captureMeasurePoint(at: point); return }
    if registerMode != "off" { captureRegisterPoint(at: point); return }
    if partPick { pickPart(at: point); return }
    // Tap-to-(re)place was removed by request: the model auto-places on load and
    // is then moved only by direct manipulation (drag / twist / height) or
    // Re-center. A plain tap no longer repositions it.
  }

  func resetTracking() {
    arView.session.run(config, options: [.resetTracking, .removeExistingAnchors])
    clearMeasurement()
    measureAnchor = nil
    clearRegistration()
    registerAnchor = nil
    // A full reset wipes the world map + every ARImageAnchor → drop all marker state.
    for e in markerEntities.values { e.removeFromParent() }
    markerEntities.removeAll(); markerTracked.removeAll(); markerBindings.removeAll(); activeMarkerName = nil
    if modelEntity != nil {
      teardownModelAnchor()
      modelPivot = nil
      modelEntity?.removeFromParent()
      if manualPlacement {
        // A full tracking reset throws away the world map → require a fresh scan.
        awaitingManualPlace = true
        pendingPlacement = false
        lastScanReady = nil
        emitScanState()
      } else {
        pendingPlacement = true
        placeAttempts = 0
        tryPlaceModel()
      }
    }
  }

  func captureSnapshotBase64(_ completion: @escaping (String?) -> Void) {
    arView.snapshot(saveToHDR: false) { image in
      completion(image?.pngData()?.base64EncodedString())
    }
  }

  // MARK: - Image-marker stabilization (FabStation-style)

  // Register the printed markers as ARReferenceImages and turn on image DETECTION in
  // the world-tracking config. Prefers a curated bundled "PcsMarkers" AR Resources
  // group (best tracking when the team supplies real images); otherwise synthesizes a
  // deterministic high-contrast pack so the feature works on a clean build and the
  // SAME images can be printed (exportMarkerSheet). Marker tracking stays a feature of
  // ARWorldTrackingConfiguration, so the LiDAR mesh + occlusion are untouched.
  private func configureMarkerDetection() {
    if referenceImages.isEmpty {
      referenceImages = Self.buildReferenceImages(widthMeters: markerWidthMeters)
    }
    guard !referenceImages.isEmpty else { return }
    config.detectionImages = referenceImages
    config.maximumNumberOfTrackedImages = 4  // track several at once → seamless hand-off
    detectionConfigured = true
  }

  private static func buildReferenceImages(widthMeters: Float) -> Set<ARReferenceImage> {
    if let group = ARReferenceImage.referenceImages(inGroupNamed: "PcsMarkers", bundle: nil), !group.isEmpty {
      return group
    }
    var imgs: Set<ARReferenceImage> = []
    let w = CGFloat(max(0.02, widthMeters))
    for i in 0..<generatedMarkerCount {
      guard let cg = makeMarkerCGImage(index: i, pixels: 512) else { continue }
      let ref = ARReferenceImage(cg, orientation: .up, physicalWidth: w)
      ref.name = "pcs-marker-\(i)"
      imgs.insert(ref)
    }
    return imgs
  }

  // A unique, asymmetric, feature-dense marker (deterministic per index): a dense
  // pseudo-random black/white grid (lots of trackable features), a heavy border with
  // a thick top-left bar (unambiguous orientation), and a human-readable id disc.
  private static func makeMarkerCGImage(index: Int, pixels: Int) -> CGImage? {
    let size = CGSize(width: pixels, height: pixels)
    let renderer = UIGraphicsImageRenderer(size: size)
    let img = renderer.image { rctx in
      let ctx = rctx.cgContext
      UIColor.white.setFill(); ctx.fill(CGRect(origin: .zero, size: size))
      // Typed UInt64 (not UInt64(...)) so the high-bit-set 64-bit constants don't
      // overflow Swift's default Int literal type.
      var seed: UInt64 = 0x9E37_79B9_7F4A_7C15 &+ UInt64(bitPattern: Int64(index)) &* 0x100_0000_01B3
      func rnd() -> UInt64 { seed = seed &* 6364136223846793005 &+ 1442695040888963407; return seed }
      let n = 16
      let cell = CGFloat(pixels) / CGFloat(n)
      UIColor.black.setFill()
      for gx in 0..<n {
        for gy in 0..<n {
          if (rnd() >> 33) & 1 == 0 { continue }
          ctx.fill(CGRect(x: CGFloat(gx) * cell, y: CGFloat(gy) * cell, width: cell, height: cell)
            .insetBy(dx: cell * 0.12, dy: cell * 0.12))
        }
      }
      let b = CGFloat(pixels) * 0.05
      UIColor.black.setFill()
      ctx.fill(CGRect(x: 0, y: 0, width: size.width, height: b))
      ctx.fill(CGRect(x: 0, y: size.height - b, width: size.width, height: b))
      ctx.fill(CGRect(x: 0, y: 0, width: b, height: size.height))
      ctx.fill(CGRect(x: size.width - b, y: 0, width: b, height: size.height))
      ctx.fill(CGRect(x: 0, y: 0, width: size.width * 0.34, height: b * 3))  // thick bar = "up"
      let disc = CGRect(x: size.width * 0.68, y: size.height * 0.68, width: size.width * 0.28, height: size.width * 0.28)
      UIColor.white.setFill(); ctx.fillEllipse(in: disc)
      ctx.setLineWidth(pixels > 256 ? 6 : 3); UIColor.black.setStroke(); ctx.strokeEllipse(in: disc)
      let s = "\(index)" as NSString
      let attrs: [NSAttributedString.Key: Any] = [
        .font: UIFont.boldSystemFont(ofSize: size.width * 0.16),
        .foregroundColor: UIColor.black,
      ]
      let ts = s.size(withAttributes: attrs)
      s.draw(at: CGPoint(x: disc.midX - ts.width / 2, y: disc.midY - ts.height / 2), withAttributes: attrs)
    }
    return img.cgImage
  }

  // Ingest ARImageAnchor adds/updates: keep a RealityKit AnchorEntity bound to each
  // (RealityKit then auto-tracks the physical marker every frame), record its tracked
  // state, and emit a throttled snapshot to JS for the HUD / bound-set bookkeeping.
  private func ingestImageAnchors(_ anchors: [ARAnchor]) {
    var changed = false
    for case let img as ARImageAnchor in anchors {
      let name = img.referenceImage.name ?? "marker"
      if markerEntities[name] == nil {
        let e = AnchorEntity(anchor: img)
        arView.scene.addAnchor(e)
        markerEntities[name] = e
      }
      markerTracked[name] = img.isTracked
      changed = true
    }
    if changed { emitMarkerUpdates() }
  }

  private func emitMarkerUpdates() {
    let now = Date()
    guard now.timeIntervalSince(lastMarkerEmit) > 0.12 else { return }  // ~8 Hz cap
    lastMarkerEmit = now
    let cam = arView.cameraTransform.translation
    var list: [[String: Any]] = []
    var accepted = 0  // bound + tracked + within quality gate (i.e. actually contributing)
    for (name, e) in markerEntities {
      let w = e.transformMatrix(relativeTo: nil)
      let pos = SIMD3<Float>(w.columns.3.x, w.columns.3.y, w.columns.3.z)
      let d = simd_distance(pos, cam)
      let bound = markerBindings[name] != nil
      let tracked = markerTracked[name] ?? false
      if bound, tracked, markerQualityWeight(distance: d) > 0 { accepted += 1 }
      list.append([
        "name": name,
        "transform": matrixToArray(w),
        "tracked": tracked,
        "bound": bound,
        "distance": d,
      ])
    }
    // Holding = lock armed and bound, but nothing acceptable in view → the model is
    // frozen on its last pose (Item 2). The HUD surfaces this so the inspector re-aims.
    let holding = markerLockEnabled && !markerBindings.isEmpty && accepted == 0
    onMarkerUpdate([
      "markers": list,
      "cameraPos": [cam.x, cam.y, cam.z],
      "active": activeMarkerName ?? "",
      "lockEnabled": markerLockEnabled,
      "acceptedCount": accepted,
      "holding": holding,
    ])
  }

  // Per-frame: drive the model's correction node from the FUSED pose of every
  // acceptable marker in view (Item 1), gated by quality (Item 2). We want
  // anchorWorld · correction = markerWorld · offset ⇒ correction =
  // anchorWorld⁻¹ · markerWorld · offset, fused across markers. The user pivot (Align
  // edits) rides on top, untouched. Eased (slerp/lerp) so jitter / hand-off doesn't pop.
  private func driveMarkerLock() {
    guard markerLockEnabled, modelPivot != nil,
          let anchor = modelAnchor, let correction = modelCorrection else { return }
    // Item 2 — freeze on degraded world tracking: HOLD the last pose rather than let a
    // bad frame slide the model.
    if lastTrackingState == "limited" || lastTrackingState == "unavailable" { return }

    let cam = arView.cameraTransform.translation
    let anchorInv = anchor.transformMatrix(relativeTo: nil).inverse
    var items: [(simd_float4x4, Float)] = []
    var bestW: Float = 0
    var bestName: String?
    for (name, e) in markerEntities {
      guard (markerTracked[name] ?? false), let offset = markerBindings[name] else { continue }
      let markerWorld = e.transformMatrix(relativeTo: nil)
      let mp = markerWorld.columns.3
      let d = simd_distance(SIMD3<Float>(mp.x, mp.y, mp.z), cam)
      let w = markerQualityWeight(distance: d)
      if w <= 0 { continue }                          // Item 2 — gate out far / untracked
      items.append((anchorInv * markerWorld * offset, w))  // candidate correction
      if w > bestW { bestW = w; bestName = name }
    }

    // Item 2 — no acceptable marker in view: HOLD (don't drift-drive, don't reset).
    guard let target = fuseCorrections(items) else { activeMarkerName = nil; return }

    // Item 2 — reject a single wild target (a misdetection) for a few frames, but accept
    // eventually so a genuine relocalization isn't stuck out.
    let cur = correction.transform.matrix
    let curT = SIMD3<Float>(cur.columns.3.x, cur.columns.3.y, cur.columns.3.z)
    let tgtT = SIMD3<Float>(target.columns.3.x, target.columns.3.y, target.columns.3.z)
    if simd_distance(curT, tgtT) > markerRejectStepM && markerOutlierStreak < 8 {
      markerOutlierStreak += 1
      return
    }
    markerOutlierStreak = 0
    activeMarkerName = bestName
    correction.transform = blendedTransform(from: cur, to: target, t: 0.35)
  }

  // Smooth distance falloff in [0,1]; 0 past the max range. A far-but-present marker
  // still contributes at low weight (not binary-lost). Mirrors marker-lock.ts
  // markerWeight (unit-tested).
  private func markerQualityWeight(distance d: Float) -> Float {
    if d > markerMaxRangeM { return 0 }
    let s = d / markerNearFavorM
    return 1 / (1 + s * s)
  }

  // Item 1 — fuse weighted rigid corrections: weighted-average translation + sign-
  // aligned weighted-average quaternion (normalized). Fusing every visible marker
  // cancels each one's individual pose noise and smooths the hand-off as you walk.
  // Mirrors marker-lock.ts fuseMarkerPoses. Returns nil when no positive weight.
  private func fuseCorrections(_ items: [(simd_float4x4, Float)]) -> simd_float4x4? {
    var wsum: Float = 0
    var tsum = SIMD3<Float>(repeating: 0)
    var qsum = SIMD4<Float>(repeating: 0)
    var ref: SIMD4<Float>?
    for (m, w) in items where w > 0 {
      let tf = Transform(matrix: m)
      var qv = tf.rotation.vector
      if let r = ref { if simd_dot(qv, r) < 0 { qv = -qv } } else { ref = qv }  // hemisphere-align
      qsum += qv * w
      tsum += tf.translation * w
      wsum += w
    }
    guard wsum > 1e-6, simd_length(qsum) > 1e-6 else { return nil }
    let qavg = simd_normalize(simd_quatf(vector: qsum / wsum))
    let r3 = simd_float3x3(qavg)
    var out = matrix_identity_float4x4
    out.columns.0 = SIMD4<Float>(r3.columns.0, 0)
    out.columns.1 = SIMD4<Float>(r3.columns.1, 0)
    out.columns.2 = SIMD4<Float>(r3.columns.2, 0)
    out.columns.3 = SIMD4<Float>(tsum / wsum, 1)
    return out
  }

  // Component-wise eased blend between two rigid transforms (lerp translation, slerp
  // rotation; scale forced to 1 — the correction is rigid).
  private func blendedTransform(from a: simd_float4x4, to b: simd_float4x4, t: Float) -> Transform {
    let ta = Transform(matrix: a)
    let tb = Transform(matrix: b)
    let tr = simd_mix(ta.translation, tb.translation, SIMD3<Float>(repeating: t))
    let rot = simd_slerp(ta.rotation, tb.rotation, t)
    return Transform(scale: SIMD3<Float>(repeating: 1), rotation: rot, translation: tr)
  }

  // JS-facing controls (wired in PcsLidarArModule).
  func setMarkerLockEnabled(_ v: Bool) {
    markerLockEnabled = v
    if !v { activeMarkerName = nil }
    onLockStatus(["lockEnabled": v, "totalBindings": markerBindings.count])
  }

  func setMarkerWidth(_ m: Float) {
    let v = max(0.02, m)
    if abs(v - markerWidthMeters) < 1e-4 { return }
    markerWidthMeters = v
    referenceImages = []  // rebuild at the new physical size
    if detectionConfigured {
      configureMarkerDetection()
      arView.session.run(config)  // no reset flags → tracking + placed model survive
    }
  }

  // Bind EVERY currently-tracked marker to the model's current pose. Call once the
  // model is correctly aligned (after drag / point-pair / auto-snap): each marker
  // stores the model's correction-world pose in its own local frame, so any of them
  // can later reproduce that exact pose drift-free.
  func bindVisibleMarkers() {
    guard let anchor = modelAnchor, let correction = modelCorrection else {
      onLockStatus(["bound": 0, "totalBindings": markerBindings.count, "reason": "not-placed"]); return
    }
    let correctionWorld = anchor.transformMatrix(relativeTo: nil) * correction.transform.matrix
    var bound = 0
    for (name, e) in markerEntities where (markerTracked[name] ?? false) {
      let markerWorld = e.transformMatrix(relativeTo: nil)
      markerBindings[name] = markerWorld.inverse * correctionWorld
      bound += 1
    }
    onLockStatus(["bound": bound, "totalBindings": markerBindings.count,
                  "reason": bound == 0 ? "no-markers-visible" : "ok"])
  }

  func clearMarkerBindings() {
    markerBindings.removeAll()
    activeMarkerName = nil
    onLockStatus(["bound": 0, "totalBindings": 0, "reason": "cleared"])
  }

  // A printable contact sheet (PNG, base64) of the generated markers, labelled with
  // their ids + physical size, so the shop prints the exact images the tracker expects.
  func exportMarkerSheet(_ completion: @escaping (String?) -> Void) {
    let count = Self.generatedMarkerCount
    let widthMm = Int((markerWidthMeters * 1000).rounded())
    DispatchQueue.global(qos: .userInitiated).async {
      let cols = 3
      let rows = (count + cols - 1) / cols
      let tile = 480, pad = 40, label = 40
      let footer = 220  // room for the scale bar + instructions
      let cellW = tile + pad, cellH = tile + pad + label
      let w = cols * cellW + pad, h = rows * cellH + pad + 60 + footer
      let renderer = UIGraphicsImageRenderer(size: CGSize(width: w, height: h))
      let out = renderer.image { rctx in
        let ctx = rctx.cgContext
        UIColor.white.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
        let head = "PCS AR markers — print at \(widthMm) mm edge, mount flat on the assembly" as NSString
        head.draw(at: CGPoint(x: CGFloat(pad), y: 20),
                  withAttributes: [.font: UIFont.boldSystemFont(ofSize: 26), .foregroundColor: UIColor.black])
        for i in 0..<count {
          guard let cg = Self.makeMarkerCGImage(index: i, pixels: tile) else { continue }
          let r = i / cols, c = i % cols
          let x = pad + c * cellW, y = 60 + pad + r * cellH
          UIImage(cgImage: cg).draw(in: CGRect(x: x, y: y, width: tile, height: tile))
          let s = "pcs-marker-\(i)" as NSString
          s.draw(at: CGPoint(x: CGFloat(x), y: CGFloat(y + tile + 6)),
                 withAttributes: [.font: UIFont.boldSystemFont(ofSize: 24), .foregroundColor: UIColor.black])
        }

        // ── Labeled scale bar (printable ruler) ──
        // Calibrated to the marker tile: a tile is `tile` px == `widthMm` mm, so this
        // 100 mm bar prints at exactly 100 mm IFF the markers print at their intended
        // size. Measure it after printing to verify scale and recover the true marker
        // size (set the app's marker size to widthMm × measured ÷ 100).
        let pxPerMm = CGFloat(tile) / CGFloat(max(1, widthMm))
        let barMm = 100
        let baseX = CGFloat(pad)
        let baseY = CGFloat(h) - 70
        let barPx = CGFloat(barMm) * pxPerMm
        let note = "Scale check: this bar = 100 mm at actual size. If it measures M mm, set the marker size to \(widthMm) × (M ÷ 100) mm (or reprint scaled by 100 ÷ M)." as NSString
        note.draw(at: CGPoint(x: baseX, y: baseY - 96),
                  withAttributes: [.font: UIFont.systemFont(ofSize: 18), .foregroundColor: UIColor.black])
        ctx.setStrokeColor(UIColor.black.cgColor)
        ctx.setLineWidth(3)
        ctx.move(to: CGPoint(x: baseX, y: baseY))
        ctx.addLine(to: CGPoint(x: baseX + barPx, y: baseY))
        for i in 0...(barMm / 10) {
          let x = baseX + CGFloat(i * 10) * pxPerMm
          let tall: CGFloat = (i % 5 == 0) ? 28 : 14
          ctx.move(to: CGPoint(x: x, y: baseY))
          ctx.addLine(to: CGPoint(x: x, y: baseY - tall))
        }
        ctx.strokePath()
        let tick: (String, CGFloat) -> Void = { txt, x in
          (txt as NSString).draw(at: CGPoint(x: x, y: baseY + 6),
            withAttributes: [.font: UIFont.systemFont(ofSize: 18), .foregroundColor: UIColor.black])
        }
        tick("0", baseX - 4)
        tick("50", baseX + CGFloat(50) * pxPerMm - 10)
        tick("100 mm", baseX + barPx - 28)
      }
      completion(out.pngData()?.base64EncodedString())
    }
  }

  // MARK: - Continuous ICP world-lock (the FrozenWorld analog)

  // A gentle, throttled refinement: ease the model onto the scanned LiDAR mesh to
  // cancel VIO drift BETWEEN marker sightings. Scheduling/throttling lives in JS
  // (drift-monitor.ts, unit-tested) which calls this; native just guards + applies a
  // small, capped fraction of the ICP correction (snapping every couple of seconds
  // would read as jitter), and only when it strictly lowers the residual.
  func refineLock() {
    // Every return path emits an onAutoAlign(continuous:true) so the JS scheduler's
    // in-flight flag always clears (no silent return can wedge the world-lock).
    guard !locked, modelEntity != nil, modelPivot != nil, modelAnchor != nil else {
      onAutoAlign(["ok": false, "reason": "not-ready", "continuous": true]); return
    }
    guard meshSupported else {
      onAutoAlign(["ok": false, "reason": "no-lidar", "continuous": true]); return
    }
    // A live marker is more authoritative than the mesh — leave the pose to it.
    if markerLockEnabled, activeMarkerName != nil {
      onAutoAlign(["ok": false, "reason": "marker-active", "continuous": true]); return
    }
    let model = gatherModelPointsWorld(cap: 500)
    guard model.count >= 20 else {
      onAutoAlign(["ok": false, "reason": "no-model-geometry", "continuous": true]); return
    }
    var lo = model[0], hi = model[0]
    for p in model { lo = simd_min(lo, p); hi = simd_max(hi, p) }
    let margin = SIMD3<Float>(repeating: 0.3)
    let (real, normals) = gatherRealMeshWorld(aabbMin: lo - margin, aabbMax: hi + margin, cap: 3500)
    guard real.count >= 80 else {
      onAutoAlign(["ok": false, "reason": "sparse-mesh", "continuous": true]); return
    }
    DispatchQueue.global(qos: .utility).async { [weak self] in
      let res = IcpAligner.solve(modelPoints: model, realPoints: real, realNormals: normals)
      DispatchQueue.main.async { self?.handleRefineResult(res) }
    }
  }

  private func handleRefineResult(_ res: IcpAligner.Result) {
    let improved = res.finalRmsM.isFinite
      && res.finalRmsM < res.initialRmsM - 0.0003
      && res.inlierRatio >= 0.3
    guard improved else {
      onAutoAlign(["ok": false,
                   "reason": res.inlierRatio < 0.3 ? "low-overlap" : "no-improvement",
                   "continuous": true,
                   "rmsMm": res.finalRmsM.isFinite ? res.finalRmsM * 1000 : 0,
                   "inlierRatio": res.inlierRatio]); return
    }
    let scaled = scaledCorrection(res.transform, gain: 0.5, maxTransM: 0.05, maxRotRad: 3 * .pi / 180)
    applyWorldCorrection(scaled)
    onAutoAlign(["ok": true, "rmsMm": res.finalRmsM * 1000, "fromMm": res.initialRmsM * 1000,
                 "inlierRatio": res.inlierRatio, "iterations": res.iterations, "continuous": true])
  }

  // Scale a rigid correction toward identity by `gain`, then cap its translation +
  // rotation magnitude (so a single continuous step can only ease the model a little).
  private func scaledCorrection(_ t: simd_float4x4, gain: Float, maxTransM: Float, maxRotRad: Float) -> simd_float4x4 {
    let tr = Transform(matrix: t)
    var dt = tr.translation * gain
    let dl = simd_length(dt)
    if dl > maxTransM, dl > 1e-6 { dt *= (maxTransM / dl) }
    let identityQ = simd_quatf(angle: 0, axis: SIMD3<Float>(0, 1, 0))
    var q = simd_slerp(identityQ, tr.rotation, gain)
    let ang = q.angle
    if ang.isFinite, ang > maxRotRad { q = simd_quatf(angle: maxRotRad, axis: q.axis) }
    let r3 = simd_float3x3(q)
    var m = matrix_identity_float4x4
    m.columns.0 = SIMD4<Float>(r3.columns.0, 0)
    m.columns.1 = SIMD4<Float>(r3.columns.1, 0)
    m.columns.2 = SIMD4<Float>(r3.columns.2, 0)
    m.columns.3 = SIMD4<Float>(dt, 1)
    return m
  }

  // Column-major [Float] (16) for the JS bridge / events (matches simd_float4x4).
  private func matrixToArray(_ m: simd_float4x4) -> [Float] {
    return [
      m.columns.0.x, m.columns.0.y, m.columns.0.z, m.columns.0.w,
      m.columns.1.x, m.columns.1.y, m.columns.1.z, m.columns.1.w,
      m.columns.2.x, m.columns.2.y, m.columns.2.z, m.columns.2.w,
      m.columns.3.x, m.columns.3.y, m.columns.3.z, m.columns.3.w,
    ]
  }

  // MARK: - ARSessionDelegate

  func session(_ session: ARSession, didUpdate frame: ARFrame) {
    if pendingPlacement { tryPlaceModel() }
    else if awaitingManualPlace { emitScanState() }
    driveMarkerLock()  // keep the model glued to the active printed marker (drift-free)
  }

  func session(_ session: ARSession, didAdd anchors: [ARAnchor]) { ingestImageAnchors(anchors) }

  func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) { ingestImageAnchors(anchors) }

  func session(_ session: ARSession, didRemove anchors: [ARAnchor]) {
    var changed = false
    for case let img as ARImageAnchor in anchors {
      let name = img.referenceImage.name ?? "marker"
      markerEntities[name]?.removeFromParent()
      markerEntities[name] = nil
      markerTracked[name] = nil
      // Keep the binding: the marker may reappear (occlusion / out-of-frame); a stale
      // binding is harmless because selectActiveMarkerNative requires it to be tracked.
      if activeMarkerName == name { activeMarkerName = nil }
      changed = true
    }
    if changed { emitMarkerUpdates() }
  }

  func session(_ session: ARSession, cameraDidChangeTrackingState camera: ARCamera) {
    let s: String
    switch camera.trackingState {
    case .normal: s = "normal"
    case .limited: s = "limited"
    case .notAvailable: s = "unavailable"
    @unknown default: s = "unknown"
    }
    lastTrackingState = s
    onTracking(["state": s, "lidar": meshSupported])
    if awaitingManualPlace { emitScanState() }
  }

  func session(_ session: ARSession, didFailWithError error: Error) {
    onError(["message": error.localizedDescription])
  }
}
