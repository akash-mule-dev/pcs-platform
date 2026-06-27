// PcsLidarArModule — Expo Modules bridge that exposes PcsLidarArView to RN.
//
// Naming MUST align across three places or the view never mounts / events never
// fire:
//   • Name("PcsLidarAr")  ← the JS lookup key for requireNativeView('PcsLidarAr')
//   • "PcsLidarArModule"  ← the class listed in expo-module.config.json apple.modules
//   • Events(...) names   ← must equal the EventDispatcher property names on the view
import ExpoModulesCore

public class PcsLidarArModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PcsLidarAr")

    View(PcsLidarArView.self) {
      Events("onLoad", "onError", "onTracking", "onAnchor", "onMeasure", "onPartTap", "onRegisterPoint", "onAutoAlign")

      // The model to render. file:// (from useRemoteModel) is the normal case.
      Prop("modelUri") { (view: PcsLidarArView, uri: URL?) in
        view.setModelUri(uri)
      }
      // The edge-view (wireframe) GLB. Kept ready; `showEdges` decides whether it
      // (baked colours preserved) or the solid model is on screen.
      Prop("wireframeUri") { (view: PcsLidarArView, uri: URL?) in
        view.setWireframeUri(uri)
      }
      // Explicit solid↔edges selector (robust — does not rely on a prop going nil).
      Prop("showEdges") { (view: PcsLidarArView, v: Bool) in view.setShowEdges(v) }
      // Edge-view colour (hex). Painted as a flat unlit fill → one uniform colour.
      Prop("edgeColor") { (view: PcsLidarArView, hex: String) in view.setEdgeColor(hex) }
      // Per-entity colour overlay for the SOLID model (Color-by Profile/Grade):
      // entity-name (== ifc_guid) → hex. Empty restores the uniform grey.
      Prop("colorOverlay") { (view: PcsLidarArView, map: [String: String]) in view.setColorOverlay(map) }

      // Mode flags — produced by modeToFlags() on the JS side so the mode→flags
      // map lives in one place (types.ts), not duplicated in Swift.
      Prop("occlusion") { (view: PcsLidarArView, v: Bool) in view.setOcclusion(v) }
      Prop("personSegmentation") { (view: PcsLidarArView, v: Bool) in view.setPersonSegmentation(v) }
      Prop("physics") { (view: PcsLidarArView, v: Bool) in view.setPhysics(v) }
      Prop("planeAnchor") { (view: PcsLidarArView, v: Bool) in view.setPlaneAnchor(v) }
      Prop("showMesh") { (view: PcsLidarArView, v: Bool) in view.setShowMesh(v) }

      // Direct manipulation (Phase 1): arms one-finger drag-to-move + two-finger
      // twist-for-yaw. Off during measure / part-pick / lock so they never clash.
      Prop("directManipulation") { (view: PcsLidarArView, v: Bool) in view.setDirectManipulation(v) }

      // Point-pair registration (Phase 2): which point the next tap captures —
      // "model" (hit-test the model) | "real" (raycast the world) | "off".
      Prop("registerMode") { (view: PcsLidarArView, v: String) in view.setRegisterMode(v) }

      // Measurement + inspection mode flags.
      Prop("measureMode") { (view: PcsLidarArView, v: String) in view.setMeasureMode(v) }
      Prop("partPick") { (view: PcsLidarArView, v: Bool) in view.setPartPick(v) }
      Prop("showOverallBox") { (view: PcsLidarArView, v: Bool) in view.setShowOverallBox(v) }
      Prop("showPartBoxes") { (view: PcsLidarArView, v: Bool) in view.setShowPartBoxes(v) }

      // ── Imperative methods on the JS component ref (run on the UI thread) ──
      AsyncFunction("resetTracking") { (view: PcsLidarArView) in
        view.resetTracking()
      }
      AsyncFunction("recenter") { (view: PcsLidarArView) in
        view.recenter()
      }
      AsyncFunction("capture") { (view: PcsLidarArView, promise: Promise) in
        view.captureSnapshotBase64 { base64 in promise.resolve(base64) }
      }

      // Align — transform edits on the placed model.
      AsyncFunction("nudge") { (view: PcsLidarArView, dx: Double, dy: Double, dz: Double) in
        view.nudge(Float(dx), Float(dy), Float(dz))
      }
      // Nudge along WORLD axes (used by the elevation handle for true world-up).
      AsyncFunction("nudgeWorld") { (view: PcsLidarArView, dx: Double, dy: Double, dz: Double) in
        view.nudgeWorld(Float(dx), Float(dy), Float(dz))
      }
      AsyncFunction("rotateModel") { (view: PcsLidarArView, pitch: Double, yaw: Double, roll: Double) in
        view.rotate(Float(pitch), Float(yaw), Float(roll))
      }
      AsyncFunction("scaleModel") { (view: PcsLidarArView, factor: Double) in
        view.scaleBy(Float(factor))
      }
      AsyncFunction("setModelLocked") { (view: PcsLidarArView, locked: Bool) in
        view.setLocked(locked)
      }

      // Measure — capture at the reticle / clear.
      AsyncFunction("capturePoint") { (view: PcsLidarArView) in
        view.captureAtReticle()
      }
      AsyncFunction("clearMeasurement") { (view: PcsLidarArView) in
        view.clearMeasurement()
      }

      // Registration — solve happens in JS (rigid-registration.ts); native captures
      // points (via taps, routed in handleTap) and applies the solved 4×4.
      AsyncFunction("captureRegisterAtReticle") { (view: PcsLidarArView) in
        view.captureRegisterAtReticle()
      }
      AsyncFunction("undoRegisterPair") { (view: PcsLidarArView) in
        view.undoRegisterPair()
      }
      AsyncFunction("clearRegistration") { (view: PcsLidarArView) in
        view.clearRegistration()
      }
      AsyncFunction("applyRegistration") { (view: PcsLidarArView, matrix: [Double]) in
        view.applyRegistration(matrix)
      }

      // Phase 3: ICP auto-snap onto the LiDAR mesh, and the see-through overlay.
      AsyncFunction("autoAlign") { (view: PcsLidarArView) in
        view.autoAlign()
      }
      AsyncFunction("setModelOpacity") { (view: PcsLidarArView, opacity: Double) in
        view.setModelOpacity(Float(opacity))
      }
    }
  }
}
