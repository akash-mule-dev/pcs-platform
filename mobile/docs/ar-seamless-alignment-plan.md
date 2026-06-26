# Seamless model→real-assembly alignment (LiDAR AR QA inspector) — implementation plan

**Status:** proposal for review. No feature code written yet.
**Scope:** the native RealityKit (LiDAR) engine only — `modules/pcs-lidar-ar` + `ARExperienceRK.tsx`. The Viro/Standard experience is untouched.
**Goal:** make placing the virtual CAD/IFC model onto the real physical steel assembly fast and effortless, and metrologically trustworthy for QA.

---

## 1. The problem, precisely

Today the LiDAR flow is **tap-a-surface → 9 manual nudge buttons** (`AlignPanel`: MOVE 4 mm/tick, ROTATE 1°/tick, SCALE ×1.03/tick, LOCK). Reading the native code (`PcsLidarArView.swift`) clarifies *which* parts are actually painful:

- **Placement orientation is already half-solved.** `placeOn(worldTransform:)` anchors the model with `AnchorEntity(world: r.worldTransform)`, and a `.estimatedPlane` raycast's transform carries the **surface normal as its Y axis** — so a successful surface tap already seats the model roughly level to the tapped plane. Pitch/roll fiddling is mostly *not* the everyday pain.
- **The real pain is HEADING (yaw):** the raycast transform's heading (X/Z) is arbitrary, so the model lands facing a random direction and the inspector spins it to match the real beam by mashing the 1°/tick Yaw button.
- **And the FALLBACK is tilted:** when no surface is found after 45 frames, `tryPlaceModel()` drops the model oriented to the **camera** (`cameraTransform`) → genuinely tilted, needing pitch/roll cleanup.
- **Translation is coarse and slow:** sliding the model into position 4 mm at a time.
- **Scale is a free knob — and that's a QA bug** (see §2).

So "seamless" = **(a)** make rough positioning a direct drag/twist instead of buttons, **(b)** make *precise* alignment a few intentional taps with a trust readout, and **(c)** lock scale.

---

## 2. The one non-negotiable: lock scale to 1:1 (do this first, regardless of scope)

`scaleBy()` is freely exposed via the `scaleModel` ref and the `AlignPanel` SCALE section. In a QA inspector this is actively harmful: an inspector can shrink the overlay until any mismatch disappears, **masking the exact fabrication deviation the tool exists to find.**

**Decision:** alignment is a **rigid 6DOF problem (rotation + translation only)**. Scale is locked to 1.0. The *only* legitimate role of scale is a **read-only sanity number** computed by the solvers (§5/§6): ≈1.00 reads "good"; >2–5 % drift actively **warns** "wrong model loaded or bad point pick" and is **never applied**.

This ships in Phase 0 and underpins everything else.

---

## 3. Recommended end-state flow

```
AIM      → ghost preview rides the reticle; tap commits (existing placeOn path)
DROP     → seated gravity-up / surface-leveled, scale locked 1:1
DRAG     → one finger slides the model across the LiDAR surface
TWIST    → two fingers spin it into heading
(SLIDE)  → edge handle for height
─────────── that's the 90% everyday case (Phases 0–1) ───────────
ALIGN BY POINTS → tap 3+ matching corners (model ↔ real) → rigid solve snaps the pose
TRUST    → live HUD: RMS mm + max-error mm + scale-sanity % + tracking confidence
CONFIRM + LOCK → residual frozen onto the QA snapshot; model returns to full opacity
```

Manual `AlignPanel` survives only as the **last-resort fine-tune** (with its SCALE section hidden in QA mode), never the primary path.

---

## 4. Phase 0 — quick win: scale-lock + leveled fallback + confidence chip  ·  effort **S** (~1 day)

### Native — `PcsLidarArView.swift`
- **Scale lock**
  - Add `private var lockScale = false`.
  - `func setLockScale(_ v: Bool) { lockScale = v; if v { userScale = 1; applyUserTransform() } }`.
  - First line of `scaleBy(_:)`: `guard !lockScale else { return }`.
- **Leveled placement (fix the tilted fallback)** — replace the camera-oriented fallback in `tryPlaceModel()` so the model is always seated **gravity-up**:
  - Keep the surface-hit branch as-is (it already inherits the surface normal).
  - In the `placeAttempts >= 45` fallback, build the transform with **translation only** (camera position + forward·0.6 − up·0.15) and an **identity/gravity-up rotation**, not `cameraTransform.matrix`. The model lands upright instead of tilted.
  - *(Optional, capped)* In the surface branch, validate the normal: if `dot(normal, worldUp) < cos(35°)` treat as a wall and fall back to gravity-up; if near-horizontal, keep the (capped ≤20°) surface tilt so genuine slopes still seat flush. This guards against a noisy `estimatedPlane` normal flipping the model.

### Bridge — `PcsLidarArModule.swift`
- `Prop("lockScale") { (view, v: Bool) in view.setLockScale(v) }`.

### Types — `PcsLidarAr.types.ts`
- Add `lockScale?: boolean;` to props.

### RN — `ARExperienceRK.tsx` + `AlignPanel.tsx`
- Pass `lockScale={true}` to `<PcsLidarArView>`.
- `AlignPanel`: add `lockScale?: boolean`; when set, **hide the SCALE `Section`** and don't wire `onScaleBy`. (The scale-readout disappears with it.) Pass `lockScale` from `ARExperienceRK`.
- Confidence chip: the tracking/confidence string already exists (`confidenceTag()`, `tracking` state in `nameBlock`). Phase 0 just keeps it visible while aligning — no new native work. *(Defer the `onAlignQuality` event to Phase 2, where it carries real numbers.)*

**Payoff:** scale can no longer fake a fit (QA integrity restored); the no-surface fallback stops landing tilted. Small, self-contained, validates auto-leveling behavior on-device before the bigger phases.

---

## 5. Phase 1 — Touch-to-Place direct manipulation (everyday coarse placement)  ·  effort **M** (1–3 days)

Replace button-mashing with direct touch. **Do NOT use `ARView.installGestures()`** — it transforms the entity in its own space, fights the load-bearing pivot/centring, and re-enables scale. Add custom recognizers routed to `modelPivot`.

### Native — `PcsLidarArView.swift`
- Conform to `UIGestureRecognizerDelegate`. In `init()`, alongside the existing `UITapGestureRecognizer`:
  - `UIPanGestureRecognizer` (`maximumNumberOfTouches = 1`) → `handlePan(_:)`.
  - `UIRotationGestureRecognizer` → `handleRotate(_:)`.
  - `gestureRecognizer(_:shouldRecognizeSimultaneouslyWith:)` → `true` for pan+rotation so they coexist.
- `private var directManipulation = false`; `func setDirectManipulation(_ v: Bool)`.
- `private var panOnModel = false`, `private var rotateBaselineYaw: Float = 0`.
- **`handlePan`** (guard `directManipulation, !locked, modelPivot != nil, measureMode == "off", !partPick`):
  - `.began`: `panOnModel = (arView.hitTest(point, query:.nearest, mask:.all).first != nil)`. If not on the model, ignore the gesture (tap-to-place still works via the separate tap recognizer).
  - `.changed` (only if `panOnModel`): `arView.raycast(from: g.location(in: arView), allowing:.estimatedPlane, alignment:.any).first` → world hit `w = simd_make_float3(r.worldTransform.columns.3)`. **Convert world → anchor-local** (`modelAnchor.convert(position: w, from: nil)` — pivot is a direct child of the anchor, so anchor-local == pivot-local). Write `userTranslate.x` and `.z` (preserve `.y`); `applyUserTransform()`. On a **nil raycast (empty space) HOLD** the last-good translation — never snap to origin/camera.
  - `.ended`: emit `onTransform`; optional conservative base re-seat.
- **`handleRotate`**: `.began` → `rotateBaselineYaw = userYaw`. `.changed` → `userYaw = rotateBaselineYaw - Float(g.rotation)` (sign tuned on-device); `applyUserTransform()`.
- **Haptics** (optional polish): `UIImpactFeedbackGenerator` (kept `.prepare()`d) — `.soft` when a drag grabs the model, `.light` on yaw detents (every 15°, stronger at cardinal headings), `.medium` "thunk" on base re-seat.
- **Elevation**: no new native — the RN edge slider calls the **existing** `nudge(0, dy, 0)` ref, so planar drag stays x/z and height stays deliberate.

### Bridge — `PcsLidarArModule.swift`
- `Prop("directManipulation") { (view, v: Bool) in view.setDirectManipulation(v) }`.
- `Events(... , "onTransform")`; `Prop`/event wiring mirrors `showEdges`/`onMeasure`.

### Native event
- `let onTransform = EventDispatcher()`; emit `{ yawDeg, translate:[x,y,z], snapped: Bool }` on `.changed`/`.ended`.

### Types — `PcsLidarAr.types.ts`
- `directManipulation?: boolean;`, `PcsLidarTransformEvent`, `onTransform?` prop, and (if a JS-side readout is wanted) it's purely advisory — native holds the truth, so no JS mirror of the transform is required for correctness.

### RN — `ARExperienceRK.tsx`
- `directManipulation={placed && !locked && measureMode === 'off' && !partTapMode}` (modes it already mutually-excludes).
- Add the elevation slider on the screen edge (reusing `nudge`).
- Keep `AlignPanel` as fine-tune.

**Payoff:** rough placement collapses from a minute of button-mashing to a ~2-second drag-and-twist, hand on the thing being aligned. Degrades on no-LiDAR exactly like the rest of the app (same `raycast` primitive, already bannered).

---

## 6. Phase 2 — Point-pair registration + mm RMS readout (the QA backbone)  ·  effort **L** (~1 week)

Tap a distinctive corner **on the model** (`hitTest`) then the **same physical point in reality** (`raycast`), ×N. Solve the optimal rigid transform; print the residual in mm.

### Architecture decision: solve in **pure TS**, apply in native
The points are captured natively and emitted to JS as world coordinates (the existing `onMeasure` pattern). Computing the solve in TS gives us a **pure, jest-testable module** (repo convention — cf. `edgeTubes.ts`/`edgeTubes.test.ts`, hand-rolled, no `gl-matrix`), and native just applies a 4×4 matrix. One source of math truth, fully unit-tested.

### New pure module — `src/screens/model-viewer/ar/rigid-registration.ts`
```ts
export interface PointPair { model: Vec3; real: Vec3; } // both WORLD-space, at the current pose
export interface RigidFit {
  matrix: number[];     // 16, column-major (simd_float4x4): T_fix mapping current-world model pts → real
  rmsMm: number;
  maxErrMm: number;
  scaleSanity: number;  // Umeyama scale — REPORTED, never applied
  inlierCount: number;
  ok: boolean;          // false if degenerate / diverged
}
export function solveRigid(pairs: PointPair[]): RigidFit;
```
- **N = 1**: translation only — `t = real − model`, `R = I`.
- **N = 2**: rotation aligning `(m1−m0)→(r1−r0)` via quaternion `from→to` (the roll about that axis is underdetermined → pick the minimal rotation); `t = r0 − R·m0`; `scaleSanity = |r1−r0| / |m1−m0|`.
- **N ≥ 3**: **Horn's quaternion method** (no SVD dependency):
  1. centroids `m̄, r̄`; cross-covariance `H = Σ (m_i−m̄)(r_i−r̄)ᵀ`.
  2. build Horn's symmetric **4×4 `N`** from `H`.
  3. largest-eigenvalue eigenvector of `N` = optimal rotation quaternion — solve via **hand-rolled Jacobi eigenvalue iteration** on the symmetric 4×4 (~10–15 sweeps; mirrors `edgeTubes`' hand-rolled style).
  4. `R` from quaternion (forced orthonormal, `det = +1`); `t = r̄ − R·m̄`.
  5. `scaleSanity = sqrt(Σ|r_i−r̄|² / Σ|m_i−m̄|²)` (computed, not applied).
- **N ≥ 4 — RANSAC**: trial-fit random 3-subsets, score inliers at ~10 mm, re-solve on the inlier set, report `inlierCount` + struck-out outliers.
- **Residuals**: `res_i = real_i − (R·model_i + t)`; `rmsMm = 1000·sqrt(mean|res|²)`, `maxErrMm = 1000·max|res|`.
- Output `matrix` column-major to drop straight into `simd_float4x4`.

### New test — `src/screens/model-viewer/__tests__/rigid-registration.test.ts`
- Synthetic round-trip: apply a known `(R,t)` to random model points → real points; assert recovered `matrix` reproduces `R·m+t` to `1e-4` (noise-free).
- With Gaussian noise: assert `rmsMm` small and the fit stable.
- **Scale detection**: scale the real points by 1.05 → `scaleSanity ≈ 1.05` while the returned `matrix` rotation stays orthonormal (scale **not** baked in).
- N = 1, 2, 3, 4 cases; a planted outlier in the N=4 case is rejected (RANSAC), `inlierCount === 3`.
- Run: `cd mobile && node node_modules/jest/bin/jest.js rigid-registration`.

### Applying the fit (native — the correct composition)
The captured model points are **world-space at the current pose**, so they already bake in `anchorWorld · pivot · centring`. We want `newChain · p_entity = T_fix · p_w = real`, i.e.:

> **`newAnchorWorld = T_fix · oldAnchorWorld`, keeping the pivot transform unchanged.**

This preserves any manual nudges already on the pivot and means we do **not** reset the pivot (a refinement over the naive "zero the pivot" approach).

- `AsyncFunction("applyRegistration") { (view, m: [Double]) in view.applyRegistration(m) }`:
  - build `T_fix: simd_float4x4` from the 16 floats; `let oldWorld = modelAnchor.transformMatrix(relativeTo: nil)`; `let newWorld = T_fix * oldWorld`.
  - remove old anchor, `AnchorEntity(world: newWorld)`, re-parent the existing `modelPivot` (unchanged), `rebuildDimensionBoxes()`. Force `userScale = 1`.

### Capture surface (native)
- `Prop("registerMode") { Bool }`.
- `AsyncFunction("captureRegisterModelPoint")` → `hitTest` center reticle → world point **+ part name** (reuse `pickPart`'s name-walk so the inspector sees which member they picked); draw a marker (reuse `addMarker`, distinct colour for model vs real).
- `AsyncFunction("captureRegisterRealPoint")` → `raycast` center → world point; marker.
- `AsyncFunction("undoRegisterPair")`, `AsyncFunction("clearRegistration")`.
- `AsyncFunction("setModelOpacity") { Double }` → generalize the existing `retint()` walk to set `UnlitMaterial` with `.blending = .transparent` + alpha, so the model goes **semi-transparent during MATCH** and misalignment is visible. (Full opacity on LOCK.)
- `Event("onAlignQuality")` → `{ pairCount, rmsMm, maxErrMm, scalePercent, outlierIndices, solved }`. Captures emit `onRegisterPoint` (`{ space:'model'|'real', point, partName? }`); JS accumulates pairs, calls `solveRigid`, then `applyRegistration` + shows the HUD.

### RN — new `RegisterPanel.tsx` (modeled on `MeasurementPanel`)
- Guided two-step capture ("Tap a corner on the **model**" → "Tap the **same** point in reality"), **reusing the existing reticle + "Place point" UI verbatim**.
- Live banner: RMS mm, max-error mm, scale-sanity % (warn if >2–5 %), tracking confidence; edges flash green + haptic when RMS < tolerance.
- Pair list with part names + struck-out outliers; Undo / Clear / Apply.
- Wire into `ARExperienceRK` as a fourth tool alongside Align/Edges/Measure (toolbar already supports the pattern; respects `onChromeBusy`).

**Payoff:** alignment becomes closed-loop and **provable** — a handful of intentional taps compute the optimal pose and print an mm residual, so any remaining virtual↔real gap is a genuine fabrication deviation worth an NCR. Open-loop nudging can never deliver this.

---

## 7. Phase 3 — one-button ICP snap + saved-pose wizard (the magic)  ·  effort **XL** — sketch only

- **`autoAlign()` (ICP to the real LiDAR mesh):** sample model surface points (walk `ModelComponent`s like `rebuildDimensionBoxes`), pull `ARMeshAnchor` geometry from `session.currentFrame`, voxel-grid bounded to the model AABB+20 cm, drop `.floor/.wall/.ceiling`-classified faces so ICP locks to the steel. Point-to-plane ICP in `simd` (~10–25 iters), seeded from the rough pose, mesh parse on a background queue → apply on `MainActor` (mirrors the GLB-load `Task → MainActor.run`). Compose through the anchor like §6.
- **Guards that REFUSE rather than lie:** divergence → revert (`reason:'diverged'`); sparse mesh → `'sparse-mesh'`; `.limited` tracking → `'tracking-limited'`. Report `rmsError + inlierRatio + impliedScale` (warn, never apply). Symmetric/repetitive steel is the known failure mode — the inlier/scale readout is the safety net.
- **Persistence:** extend the existing `arRegistration.ts` helper (today saves scale/rotation/renderMode per `modelId`) to persist the solved **pose** keyed by `qaContext.assemblyNodeId`; offer "Restore alignment" on reopen. Best-effort; fall back to a quick re-match if relocalization fails.
- **Wizard:** wrap Phases 1–3 in an `AIM → MATCH → CONFIRM → LOCK` flow (a `Prop("alignPhase")`): ghost in AIM, semi-transparent + green/haptic snap in MATCH, verdict card stamping residual+confidence onto the QA snapshot in CONFIRM, full-opacity freeze in LOCK.

---

## 8. Files touched (Phases 0–2)

| File | Phase 0 | Phase 1 | Phase 2 |
|---|---|---|---|
| `modules/pcs-lidar-ar/ios/PcsLidarArView.swift` | scale lock, leveled fallback | gestures, `directManipulation`, `onTransform`, haptics | register capture, `applyRegistration`, `setModelOpacity`, `onAlignQuality` |
| `modules/pcs-lidar-ar/ios/PcsLidarArModule.swift` | `lockScale` prop | `directManipulation` prop, `onTransform` event | register props/events/functions |
| `modules/pcs-lidar-ar/src/PcsLidarAr.types.ts` | `lockScale` | gesture prop + event type | register types |
| `src/screens/model-viewer/ar/ARExperienceRK.tsx` | pass `lockScale` | arm gestures, elevation slider | RegisterPanel wiring + HUD |
| `src/screens/model-viewer/ar/AlignPanel.tsx` | hide SCALE in QA | — | — |
| `src/screens/model-viewer/ar/rigid-registration.ts` | — | — | **new** pure solver |
| `src/screens/model-viewer/__tests__/rigid-registration.test.ts` | — | — | **new** unit tests |
| `src/screens/model-viewer/ar/RegisterPanel.tsx` | — | — | **new** UI |

**Untouched, load-bearing:** `recenterEntityToBase`, `placeOn`'s recenter/pivot structure, `applyUserTransform`'s composition order — every new transform composes *onto* the pivot or folds into the anchor (§6). `ARExperienceRK`'s visual polish stays as-is; this is additive.

---

## 9. Build & verify

- **JS-only changes** (RN/TS, the solver + tests): `cd mobile && node node_modules/typescript/bin/tsc --noEmit` then `node node_modules/jest/bin/jest.js rigid-registration` (and the existing `src/screens/model-viewer/__tests__`). Relaunch only — Metro serves the bundle.
- **Swift changes** (every phase except the pure solver/tests): rebuild + reinstall via `xcodebuild … -destination 'id=00008142-000228E1017B401C' build` → `xcrun devicectl device install` → `process launch --terminate-existing com.fabrixr.pcs` (prefix `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8`).
- On-device verification is manual (Appium can't drive the iPad over Wi-Fi — USB only).

---

## 10. Open questions (decide before building Phase 2+)

1. **Tolerance source** for the green/haptic "good" snap and the Confirm verdict: one org-wide mm threshold, or derived from the assembly's QC tolerance / the active stage's ITP hold-point spec?
2. **Audit trail:** persist the registration RMS + tracking confidence + scale-sanity onto the `quality_data` record (notes or a new column), or only stamp them onto the evidence snapshot image?
3. **No-LiDAR / tracking-limited devices:** still offer point-pair registration (residual honestly reads higher on `estimatedPlane`), or hard-gate the metrology features and fall back to direct manipulation + leveling only?
4. **Persistence (Phase 3):** is per-assembly saved-pose worth the ARWorldMap effort given relocalization is best-effort and scenes change between visits — or only persist the pivot pose and always require a quick re-match?
5. **One entry point?** Keep `AlignPanel`'s absolute MOVE/ROTATE nudges available outside the wizard, or fully subsume them into the MATCH-step fine-tune?
