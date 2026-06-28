# AR drift stabilization — marker lock + continuous world-lock (LiDAR engine)

**Status:** implemented (native RealityKit/LiDAR engine — `modules/pcs-lidar-ar` +
`ARExperienceRK.tsx`). The Viro/Android path is untouched.
**Goal:** the projected CAD/IFC model must stay **glued to the real steel assembly and
not drift** as the inspector walks the piece — and stay metrologically trustworthy.

## Why (the gap this closes)

The native engine already anchored the model to a session-tracked `ARAnchor` (so it
rides ARKit relocalization) and offered one-shot ICP auto-snap + point-pair
registration. But its own comments flagged the real hole: a free/session anchor is
**not** corrected frame-to-frame, so the model accumulates **VIO drift** as you walk
the length of a large member, and the only fix was to manually re-snap at the far end.

## Inspiration — FabStation (the reference build in `Downloads/Test`)

FabStation (Unity) defeats drift with:

- **Vuforia Image Targets** — many printed markers (`MarkerPackA/B/C`: 60+ `steelNN`
  markers, `ship_N`, `FabSTN_QR_3x3_1024`) stuck on the steel; the model re-anchors to
  whichever marker you've walked up to.
- **Microsoft World Locking Tools / FrozenWorld** — a continuous drift-correction layer
  that keeps content pinned between marker sightings.

This refactor brings both ideas to ARKit/RealityKit.

## The stabilization stack (authority order, highest first)

1. **Image-marker lock + multi-marker fusion** — printed markers registered as
   `ARReferenceImage`s on the **world-tracking** config (so the LiDAR mesh + occlusion
   are kept). Each detected `ARImageAnchor` is re-solved against the physical marker
   every frame; binding the model to a marker (offset stored in the marker's local
   frame) and driving the pose from `markerWorldLive · offset` cancels VIO drift. When
   several markers are visible their candidate poses are **fused** (quality-weighted by
   distance) into one steady pose rather than snapping to the nearest, which cancels
   per-marker noise and makes the hand-off seamless as you walk the piece.
   *(`markerWeight` + `fuseMarkerPoses` in `marker-lock.ts`, mirrored natively.)*
   - **Quality gating + freeze (no-drift safety):** untracked or out-of-range markers
     are dropped; a single wild detection is rejected for a few frames; and when **no
     acceptable marker is in view or world tracking is `limited`**, the model **freezes**
     on its last good pose instead of sliding. The HUD shows "Holding — re-aim at a
     marker" so the inspector knows to re-acquire one.
2. **Continuous ICP world-lock (FrozenWorld analog)** — between marker sightings, a
   throttled, **capped + eased** ICP refinement onto the LiDAR mesh nudges the model
   back onto the real surface (revert-if-not-better). Suppressed while a marker is
   active or the user is editing.
3. **Tracked `ARAnchor` baseline** — the prior behaviour; holds the last good pose.

A **drift monitor** drives the HUD lock state (`Locked / Locking… / Drifting / Place /
Lost`) and schedules the continuous refine.

## Where it lives

| Concern | File |
|---|---|
| Pure 4×4 math | `src/screens/model-viewer/ar/mat4.ts` |
| Marker bind/offset + active-marker policy (tested) | `ar/marker-lock.ts` |
| Lock-state machine + refine scheduler (tested) | `ar/drift-monitor.ts` |
| JS brain wiring the above to native | `ar/useStabilizer.ts` |
| Stability tool UI | `ar/LockPanel.tsx` (+ `ToolBar.tsx` "Lock" tab) |
| Native engine: detection, binding, per-frame drive, continuous refine, marker sheet | `modules/pcs-lidar-ar/ios/PcsLidarArView.swift` |
| Bridge props/events/methods | `modules/pcs-lidar-ar/ios/PcsLidarArModule.swift`, `src/PcsLidarAr.types.ts` |

Unit tests: `__tests__/marker-lock.test.ts`, `__tests__/drift-monitor.test.ts`
(`node node_modules/jest/bin/jest.js marker-lock drift-monitor`).

## Inspector workflow

1. Open the assembly in the LiDAR AR view; scan + place the model as today.
2. Rough-align (drag/twist), then refine with **Points** (point-pair) or **Auto-snap**.
3. Open the **Lock** tab → turn on **Marker lock**.
4. **Print marker sheet** (one-time per shop): exports a PNG contact sheet; print at
   **100% (1:1)** so each marker's edge = `MARKER_WIDTH_M` (150 mm). Mount markers flat
   on/near the assembly.
5. Aim the camera at a marker → **Bind to marker**. The model is now pinned; walking to
   another marker hands off automatically. Turn on **Continuous lock** to also auto-trim
   drift where no marker is visible.

> Tracking quality: the runtime-generated markers work out of the box. For best
> robustness, drop curated, high-feature images into an **AR Resources** asset group
> named `PcsMarkers` (printed at the same physical size) — `buildReferenceImages()`
> prefers it automatically.

## Verification

- **JS/TS (runs in CI / sandbox):** `node node_modules/typescript/bin/tsc --noEmit`
  and `node node_modules/jest/bin/jest.js src/screens/model-viewer` (8 suites).
- **Native (device only):** RealityKit/ARKit can't run in the simulator. Rebuild +
  install on a LiDAR iPad (see `ar-seamless-alignment-plan.md` §9), then verify on-device:
  marker detection, bind, walk-the-piece hand-off, and that the overlay no longer drifts.
