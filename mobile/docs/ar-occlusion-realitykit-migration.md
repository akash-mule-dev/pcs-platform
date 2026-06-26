# AR Occlusion — RealityKit Migration Plan (scoping)

**Status:** scoping only — nothing in here is built yet.
**Goal:** make a real-world object (a hand, a beam, a wall) that passes between the
camera and the rendered model correctly **occlude** the model — i.e. the model is
hidden *behind* the real object, the way ARKit's "people occlusion" and LiDAR
"scene occlusion" do it.

---

## 1. Why this needs a migration (the constraint we proved)

The AR view today is built on `@reactvision/react-viro` 2.43.3. We verified at the
**native-binary level** that Viro cannot do real-world occlusion on either platform:

- **iOS** — `ViroKit.framework` links ARKit but references *none* of the occlusion/
  depth APIs: no `personSegmentation` / `frameSemantics` / `sceneDepth` /
  `sceneReconstruction`, and it uses a plain `ARConfiguration` (never
  `ARWorldTrackingConfiguration.frameSemantics`). Its renderer only takes the RGB
  camera background.
- **Android** — Viro bundles ARCore (which *has* the Depth API) but Viro's own
  renderer (`libviro_arcore.so`) never calls `ArConfig_setDepthMode` or
  `ArFrame_acquireDepthImage`; it only acquires the RGB camera image + point cloud.
- **JS** — there is no `occlusionMode` / `depthEnabled` prop (the ones the app used
  to pass were silently inert and have since been removed). The only "occlusion"
  token in the package is `ambientOcclusionTexture` (a PBR shading map — unrelated).

Occlusion fundamentally requires a **per-pixel depth or segmentation matte** sampled
every frame and composited against the renderer's z-buffer. Because Viro ships its
own Metal/GL renderer that never requests these buffers, the only way to get true
occlusion is to render the model with an engine that does. On iOS that engine is
**RealityKit** (`ARView`); it gives us occlusion almost for free.

> Note: the depth-only "occluder material" trick (a `colorWritesMask:"None"` quad
> that writes depth) only hides geometry behind **static surfaces you author** — it
> can never track a moving hand. It is not a substitute.

---

## 2. What RealityKit gives us

Two independent occlusion sources, both first-class in `ARView`:

| Capability | API | Hardware | Occludes |
|---|---|---|---|
| **People occlusion** (the hand case) | `config.frameSemantics.insert(.personSegmentationWithDepth)` | **A12+ Bionic — no LiDAR needed** | hands, arms, people in front of the model |
| **Scene occlusion** (walls, beams, the real part) | `arView.environment.sceneUnderstanding.options.insert(.occlusion)` + `config.sceneReconstruction = .mesh` | **LiDAR devices only** | any real geometry the LiDAR mesh covers |

The hand problem the user hit is solved by the **first** row — and it works on every
device the app already targets (A12 = iPhone XS / 2018+), *including non-LiDAR ones*.
The second row is the bonus that finally puts the LiDAR sensor to real use.

Minimal config sketch:

```swift
let config = ARWorldTrackingConfiguration()
config.planeDetection = [.horizontal, .vertical]
if ARWorldTrackingConfiguration.supportsFrameSemantics(.personSegmentationWithDepth) {
    config.frameSemantics.insert(.personSegmentationWithDepth)   // hand/people occlusion
}
if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
    config.sceneReconstruction = .mesh                            // LiDAR scene mesh
    arView.environment.sceneUnderstanding.options.insert(.occlusion)
}
arView.session.run(config)
```

---

## 3. The hard part: RealityKit does not load GLB

This is the biggest technical risk and the main driver of effort.

- RealityKit loads **USDZ** / `.reality` natively. It has **no GLB/glTF loader**.
- Our conversion pipeline (`backend/src/conversion/`, `cad-conversion/scripts/
  convert-*.mjs`) produces **GLB**, and the whole 3D stack (web `ThreeViewerComponent`,
  the mobile Viro path, the join key `mesh_name == ifc_guid`) is built on GLB.

Two ways to bridge it, pick one:

- **(A) Server-side GLB → USDZ (recommended).** Add a USDZ artifact next to the GLB
  in the conversion pipeline (Apple's `usdzconvert` / `usd_from_gltf`, or a Node glTF→USD
  step). Pros: the device just downloads a native asset; node naming is preserved if
  we map glTF node names → USD prim names (needed to keep the `ifc_guid` highlight/
  overlay join working). Cons: a new pipeline output + storage key
  (`<org>/models/<id>.usdz` via `StorageKeys`), and `usd_from_gltf` is finicky about
  materials (we already assign a flat steel material, which helps).
- **(B) Runtime glTF → RealityKit loader on-device.** Use GLTFKit2 (parses glTF →
  `MeshResource`/`ModelEntity`) or a custom loader. Pros: reuses the existing GLB
  asset, no pipeline change. Cons: heavyweight dependency, large-model parse cost on
  device, and we own the material/normal fix-ups the GLB needs (IFC GLBs carry no
  normals/materials — see `ARModelScene` `steelSolid` material note).

> Recommendation: **(A)**. It keeps the device side simple and is consistent with how
> the platform already treats blobs as pre-baked artifacts. Emit USDZ as an *additional*
> output so the GLB path (web + the Viro fallback) is untouched.

---

## 4. Architecture: an Expo native module, not a fork

We do **not** fork Viro. We add a **custom Expo native view module** (Swift) that wraps
`ARView`, mirroring how the project already manages native config via a plugin
(`plugins/withViroMainApplicationFix.js`, Expo SDK 52 prebuild).

```
mobile/modules/pcs-ar-occlusion/        # new Expo module (iOS only to start)
  ios/PcsArView.swift                    # ARView + ARWorldTrackingConfiguration + occlusion
  ios/PcsArViewModule.swift              # expo-modules-core view + props/events bridge
  src/PcsArView.tsx                      # RN component: <PcsArView modelUri rotation … />
  expo-module.config.json
```

Props/events to expose (to match what the JS layer already drives):
`modelUri` (USDZ), `scale`, `rotation`, `anchorMode`, plus events
`onModelLoaded`, `onAnchorFound`, `onTrackingStateChanged`, `onTap` (hit-test).
The existing `useModelState`, measurement reducers, QA overlays, and HUD in
`ar/ARExperience.tsx` can largely be **reused** — only the `<ViroARScene>` subtree in
`ar/ARModelScene.tsx` is swapped for `<PcsArView>`.

**Platform strategy:** RealityKit is iOS-only. Options:
- **iOS-first (recommended):** ship occlusion on iOS via this module; keep the current
  Viro path on Android (no occlusion there, same as today). A capability flag picks the
  renderer at runtime.
- **Cross-platform later:** Android occlusion would need a separate native renderer
  (SceneView/Filament + ARCore Depth API) — a second, larger workstream. Defer unless
  Android occlusion is a hard requirement.

---

## 5. Feature-parity checklist (what must survive the swap)

The current AR view is feature-rich; each item below is re-implemented on `ARView` or
bridged. This list IS the bulk of the effort — occlusion itself is the easy part.

- [ ] Camera-first mount (live camera before model) — `ARView` is live immediately ✓ easy
- [ ] Stream + load model — **USDZ** load + fade-in
- [ ] Auto-fit scale from bounding box — `entity.visualBounds` (RealityKit gives real bounds; no empty-bbox problem)
- [ ] Auto-place in front of camera — `raycast` / camera transform
- [ ] **Lock to surface** anchoring — RealityKit `AnchorEntity(.plane)` (the native analog of the ViroARPlane we just added)
- [ ] Pinch / rotate / nudge gestures — RealityKit `installGestures` or custom
- [ ] Measurement: model ruler, real ruler, deviation probe — `raycast` hit-tests + `ModelEntity` line/sphere primitives (re-do `MeasurementOverlays`)
- [ ] Dimension overlays (mm labels) — RealityKit `attachments` / `ModelEntity` text; reuse `dimensionExtractor`
- [ ] QA overlays (heatmap / tap-QA / status) — re-bind `QaPartsOverlay` to RealityKit entities by `ifc_guid` prim name
- [ ] Edge / wireframe view — needs the wireframe GLB→USDZ too, or a RealityKit material variant
- [ ] Snapshot for QA evidence — `arView.snapshot(...)` (replaces `arSnapshot.ts`)
- [ ] Tracking-state banners, drift recovery — `session(_:cameraDidChangeTrackingState:)`
- [ ] Offline QA queue, sign-off, idempotency — **unchanged** (lives above the renderer in `useQualityData`/`qaOfflineQueue`)
- [ ] Tracking-mode switcher — collapses; RealityKit handles alignment automatically (revisit the 3-mode UI)
- [ ] `ifc_guid` join key for highlight/overlay — depends on USDZ preserving glTF node names (see §3)

---

## 6. Phasing & rough effort

| Phase | Work | Rough effort |
|---|---|---|
| **0. Spike** | Bare Expo native `ARView` module; load one hardcoded USDZ; turn on `.personSegmentationWithDepth`; confirm a hand occludes on a real A12+ device | 2–4 days |
| **1. GLB→USDZ pipeline** | Add USDZ output to the conversion pipeline with node-name preservation; new storage key; download path | 3–5 days |
| **2. Core viewer parity** | Load/auto-fit/place/anchor/gestures + fade-in behind the existing HUD; runtime renderer flag (RealityKit on iOS, Viro elsewhere) | 1–2 weeks |
| **3. Tooling parity** | Measurement, dimension overlays, QA overlays, snapshot, tracking banners | 1–2 weeks |
| **4. Polish + device matrix** | LiDAR scene occlusion, edge/wireframe, non-LiDAR A12 path, iPad/iPhone matrix, regressions | 1 week |

**Total: ~5–7 weeks** for full iOS parity + occlusion. The **occlusion result the user
asked for is demonstrable at the end of Phase 0** (a few days) — that's the cheap proof
point before committing to the rest.

---

## 7. Risks & open decisions

- **GLB→USDZ fidelity** — material/normal loss (IFC GLBs are bare); node-name → prim-name
  mapping must hold or every overlay/highlight breaks. *Mitigation: validate on a real
  IFC export early in Phase 1.*
- **iOS-only occlusion** — Android stays on Viro (no occlusion) unless we fund the
  ARCore-Depth Android renderer. **Decision needed:** is iOS-only occlusion acceptable?
- **Two renderers to maintain** — until/unless Viro is fully retired, the AR feature has
  a RealityKit (iOS) and a Viro (Android/fallback) path. Worth it only if occlusion is
  a real requirement.
- **Expo prebuild** — `mobile/ios` is a gitignored prebuild that drifts from
  `app.config.js`; the new module needs a config plugin so prebuilds stay reproducible
  (follow the `withViroMainApplicationFix` precedent).
- **Device-only validation** — RealityKit/ARKit (like Viro) cannot be tested in the
  simulator; every phase needs a physical A12+ (and a LiDAR device for Phase 4).

---

## 8. Recommendation

1. **Do Phase 0 first** as a throwaway spike — it proves hand occlusion on a real device
   in days and de-risks the whole effort before committing.
2. If it lands and occlusion is confirmed valuable, proceed iOS-first (Phases 1–4),
   keeping Viro as the Android/fallback renderer behind a capability flag.
3. Revisit Android occlusion (ARCore Depth + Filament) only if it becomes a hard
   requirement — it is a separate, comparably-sized workstream.

Meanwhile, the **stability fixes already shipped** (gravity world-alignment, always-on
plane detection that engages LiDAR for plane-finding, and the opt-in *Lock to surface*
plane anchoring) are independent of this migration and stand on their own.
