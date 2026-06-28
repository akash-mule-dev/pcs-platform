# AR image-marker tracking — highlight, identification & stability benchmark

**Status:** implemented (LiDAR/RealityKit engine — `modules/pcs-lidar-ar` + `ARExperienceRK.tsx`).
Builds on the marker-lock anti-drift core (`ar-drift-stabilization.md`); the Viro/Android
path is untouched.
**Goal:** make the printed-marker tracking a *fully-fledged* feature — the inspector can
**see** which markers the engine recognises on the steel, and can **prove** how much the
markers steady the overlay (markers OFF vs ON), not just trust that they do.

## What this adds on top of marker lock

The marker-lock brain (`marker-lock.ts`) + native per-frame drive already pin the model to
the nearest printed marker and fuse several markers to cancel VIO drift. Detection was
always on, but the markers were **invisible** tracking anchors and there was **no way to
quantify** the benefit. This feature closes both gaps:

1. **In-view highlight + identification.** Every detected `ARImageAnchor` now gets a
   colour-keyed square frame drawn *on the physical marker* (native, `PcsLidarArView`), and
   a 2D HUD (`MarkerOverlay`) lists each recognised marker by id, distance and state. The
   inspector can confirm at a glance what the engine sees and whether enough markers are
   bound to hold the model. Colour = state (one definition in `marker-format.ts`, mirrored
   natively):

   | Colour | State | Meaning |
   |---|---|---|
   | 🟢 green | `active` | this marker is driving the fused pose right now |
   | 🔵 blue | `bound` | bound to the model; contributing to the fusion |
   | 🟠 amber | `tracked` | detected but not yet bound (open **Lock → Bind**) |
   | ⚫ slate | `stale` | last-known pose; not tracked this frame |

   Toggle with the top-right **Markers** chip (`markerHighlight` prop, default on).

2. **Stability benchmark (markers OFF vs ON).** A new **Bench** tab records two short runs
   and prints the headline number — *how much steadier the overlay sits on the real
   assembly* — with an exportable log for your benchmarking records.

## How the benchmark measures the difference (the method)

Marker **detection** is always on, independently of whether marker **lock** is armed
(`configureMarkerDetection`). So in **both** runs a tracked reference marker is available,
and it is the drift-free ground truth: an `ARImageAnchor` is re-solved against the physical
marker every frame, so it stays glued to the real steel while ARKit's world frame slips
under VIO drift. We therefore score the model's pose **in the reference marker's frame**
(`marker⁻¹ · model`) — i.e. the overlay's position/orientation *relative to the real
object*:

- **Lock OFF** — the model is a fixed *world* anchor, so as the world frame drifts the
  marker (re-solved against reality) moves under it and the relative pose **wanders**. That
  wander *is* the visual drift of the overlay off the steel.
- **Lock ON** — the model is driven by the marker, so the relative pose is constant by
  construction; only fusion/easing jitter remains.

For each run we reduce the pose stream to (`stability-benchmark.ts`, pure + unit-tested):

- **drift RMS / max (mm)** — deviation of the relative pose from the run's reference pose
  (sustained wander — the headline).
- **jitter RMS / max (mm)** — frame-to-frame translation deltas (high-frequency shake).
- **rotational jitter / drift (deg)**, plus sample count, duration, and the
  marker-referenced fraction (so a run that lost the marker is flagged, not trusted).

`compareRuns` then reports `driftReductionMm` + `%` and a one-line verdict
(*"Markers cut overlay drift 18.4 → 2.1 mm (89% steadier on the assembly)."*).

### Using it on the iPad

1. Place + align the model as usual; aim at a printed marker and **Bind** (Lock tab).
2. Open **Bench**. Hold the iPad on the assembly with a marker in view.
3. Tap **1 · Without markers** — hold the ~12 s run (marker lock is turned off for it).
4. Tap **2 · With markers** — it re-enables lock (auto-binding what's visible) and records.
5. Read the result card; tap **Export log** → a spreadsheet-ready **CSV** (the full **JSON**
   log, incl. every pose sample + the comparison, is saved beside it).

## Marker placement (inspiration: FabStation, done better)

FabStation (Vuforia) blankets the steel with **size-tiered marker packs** — `MarkerPackA/B`
ship ~60 `steelNN` targets (650 mm), `MarkerPackC` 8 `ship_N` (253 mm), plus small
`FabSTN_QR_3x3` (76 mm) — and re-anchors to whichever is nearest. PCS now generates **24**
distinct printed markers (was 12) and tracks up to **6** at once, and goes beyond
FabStation's "snap to nearest" with **quality-weighted multi-marker fusion** + a continuous
ICP world-lock between sightings (`marker-lock.ts`, `drift-monitor.ts`).

Placement guidance:

- Print the sheet 1:1 (**Lock → Print marker sheet**); each marker's edge must equal
  `markerWidthMeters` (150 mm default — the size is stamped on the sheet).
- Mount markers **flat** on/near the steel, spread along the piece so at least one is in
  view from every working position; 0.3–1.0 m from the camera tracks best.
- Bigger markers track from farther: for long members print at a larger size and set
  `markerWidthMeters` to match, or drop curated high-feature images into an **AR Resources**
  group named `PcsMarkers` (the loader prefers it automatically).

## Where it lives

| Concern | File |
|---|---|
| Pure benchmark math (jitter/drift, compare, export) | `ar/stability-benchmark.ts` (+ `__tests__/stability-benchmark.test.ts`) |
| Pure marker state→colour/label + summary | `ar/marker-format.ts` (+ `__tests__/marker-format.test.ts`) |
| In-view marker HUD | `ar/MarkerOverlay.tsx` |
| Benchmark recorder hook | `ar/useStabilityBenchmark.ts` |
| Benchmark UI | `ar/BenchmarkPanel.tsx` |
| Native: highlight entities, pose-sample telemetry, 24-marker library | `modules/pcs-lidar-ar/ios/PcsLidarArView.swift` |
| Bridge props/events (`markerHighlight`, `poseSampling`, `onPoseSample`) | `…/PcsLidarArModule.swift`, `…/src/PcsLidarAr.types.ts` |
| Wiring (Markers chip, HUD, Bench tab, export) | `ar/ARExperienceRK.tsx`, `ar/ToolBar.tsx`, `ar/useStabilizer.ts` |

## Verification

- **JS/TS (CI / sandbox):** `node node_modules/typescript/bin/tsc --noEmit` (no new errors)
  and `node node_modules/jest/bin/jest.js src/screens/model-viewer` — 11 suites incl. the
  new `stability-benchmark` (16) + `marker-format` (6).
- **Native (device only):** RealityKit/ARKit can't run in the simulator. Rebuild + install
  on a LiDAR iPad (see `ar-seamless-alignment-plan.md` §9), then verify on-device: each
  detected marker shows a colour-keyed frame; the Bench A/B reports a real mm reduction with
  lock on.
