# AR drift stabilization — on-device test plan (iPad Pro / LiDAR)

How to validate the marker lock + multi-marker fusion + quality-gating/freeze work that
keeps the projected model from drifting off the real assembly. The marker/ARKit code is
native Swift and **cannot run in the simulator or CI** — it must be tested on a physical
iPad Pro with LiDAR. Automated checks below cover only the pure math/policy.

---

## Track A — automated checks (no device, run anytime)

```
cd mobile
node node_modules/typescript/bin/tsc --noEmit
node node_modules/jest/bin/jest.js src/screens/model-viewer
```

Expected: `tsc` clean; **8 suites / 77 tests** pass (marker fusion, quality weighting,
drift monitor, rigid solver). This is the limit of what can be verified off-device.

---

## Track B — on the iPad Pro

### 1. Build the native app (a JS reload is NOT enough — the marker work is Swift)

Repo specifics: workspace `mobile/ios/PCS.xcworkspace`, scheme **PCS**, bundle
`com.fabrixr.pcs`, Pods already installed.

**Xcode (recommended):**
1. Plug in the iPad Pro (a LiDAR model).
2. `open mobile/ios/PCS.xcworkspace`
3. Select the **PCS** scheme and your iPad as the destination; confirm a Team under
   *Signing & Capabilities*.
4. Start the JS bundler: `cd mobile && npx expo start`
5. Run (⌘R). If the Swift changes don't appear, `cd mobile/ios && pod install` then rebuild.

**CLI alternative:**
```
xcrun devicectl list devices                     # get the iPad UDID
cd mobile/ios
xcodebuild -workspace PCS.xcworkspace -scheme PCS -configuration Debug \
  -destination 'id=<UDID>' build
xcrun devicectl device install app --device <UDID> \
  <DerivedData>/Build/Products/Debug-iphoneos/PCS.app
xcrun devicectl device process launch --terminate-existing --device <UDID> com.fabrixr.pcs
```

**If local signing is painful:** `cd mobile && eas build --profile dev --platform ios`
and install the resulting build. Point the app at a reachable backend and log in.

### 2. Get the markers (they come from the app)

1. Open an assembly → AR (LiDAR) → **Lock** tab → **Print marker sheet**.
2. This generates a PNG of 12 unique markers via the iOS share sheet (the same images the
   tracker is looking for — no external download).

### 3. Print at a KNOWN size (don't fight "100%")

A PNG has no physical size and AirPrint usually "fits to page," so an exact 150 mm is hard
to force. What matters is that the printed size **matches what the app is told** — the
marker does not have to be exactly 150 mm.

The sheet prints a **labeled 100 mm scale bar** at the bottom, calibrated to the marker
tiles — so you can verify scale directly instead of guessing at "100%".

Reliable workflow:
1. Print the sheet (AirPrint from the share sheet, or AirDrop/email the PNG to a Mac and
   print from **Preview → Print → uncheck "Scale to Fit" → Scale 100%** for real control).
2. **Measure the scale bar** with a ruler/tape. At actual size it reads 100 mm; whatever
   it measures (M mm) is your true print scale.
3. Make the app's marker size match (the sheet's note spells out the same formula):
   - If the bar isn't 100 mm, either re-print scaled by **100 ÷ M** (e.g. bar = 87 mm →
     print at ~115%) until it reads 100 mm, **or** set the marker size to
     **150 × (M ÷ 100) mm** — today the constant `MARKER_WIDTH_M` in `ar/ARExperienceRK.tsx`.
4. Mount 2–3 markers flat on/near the assembly, spread along its length, all the same size.

> Tip: bigger markers track from further away. 150 mm is a good shop default at
> arm's-to-2 m range; print larger (e.g. 250 mm) for long stand-off.

### 4. Test checklist (what to do → what should happen)

1. **Place + align** — scan, place, rough-align by dragging, then refine with **Points**
   (point-pair) or **Auto-snap**. Note the mm RMS readout.
2. **Bind** — Lock tab → **Marker lock ON** → aim at a marker → **Bind to marker**.
   HUD should read *"Fused on N marker(s)"*.
3. **Drift test (headline)** — keep a marker in view and walk the length of the piece.
   The overlay stays glued to the steel. Quantify: drop a **deviation probe**
   (Measure → deviation) on a known corner before and after walking — it should stay
   within a few mm. ✅ pass = no visible slide.
4. **Fusion** — with 2+ markers visible, confirm it's steadier (less jitter) than one,
   and that walking past the nearest marker hands off with **no pop**.
5. **Freeze** — turn away from all markers (or trigger limited tracking). HUD switches to
   *"Holding — re-aim at a marker"* and the model **holds** (no slide/jump). Re-aim →
   it re-locks. ✅ pass.
6. **Gating** — view a marker from >3 m or a steep angle; it must **not** yank the model.
7. **Continuous lock (markerless)** — turn Marker lock OFF, Continuous lock ON; it should
   ease the model onto the LiDAR mesh (HUD *Locking… → Locked*) with no jumps.

### 5. Report back

Note **where** any drift appears — e.g. "creeps once no marker is visible for ~3 m,"
"jitters at hand-off," "model mis-scaled vs the steel" (→ marker size mismatch, see §3).
Tuning knobs if needed: marker quality range/falloff and outlier/ease constants in
`PcsLidarArView.swift` (`markerMaxRangeM`, `markerNearFavorM`, `markerRejectStepM`, the
`0.35` ease); drift thresholds in `drift-monitor.ts`. If drift persists where no marker is
ever visible, the next step is the heavier options (per-assembly persistence / object
detection).

---

## Notes

- On-device testing is **manual** — AR needs the real camera + world, so Maestro/Appium
  flows (`mobile/.maestro`, `test-ar-flow.yaml`) can't validate tracking.
- Architecture + file map: `ar-drift-stabilization.md`.
