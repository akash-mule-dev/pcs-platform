// GltfModelLoader — direct GLB → RealityKit Entity, no USDZ round-trip.
//
// Compiled ONLY when the GLTFKit2 Swift package is linked (see README for the
// SPM / vendored-xcframework setup). Until then PcsLidarArView falls back to a
// placeholder box, so the module builds and the LiDAR modes work with zero
// third-party dependencies.
//
// GLTFKit2 (github.com/warrenm/GLTFKit2, 0.5.15) exposes:
//   GLTFRealityKitLoader.load(from: URL) async throws -> RealityKit.Entity
// which parses the .glb and returns a ready-to-add Entity. RealityKit itself
// can only load USDZ/.reality, so this is the path that lets us reuse the same
// GLBs the rest of the app already produces.
#if canImport(GLTFKit2)
import Foundation
import RealityKit
import GLTFKit2

enum GltfModelLoader {
  /// Loads a GLB (local file:// or remote http(s)://) into a RealityKit Entity.
  /// `useRemoteModel` on the JS side already downloads to a file:// cache URL, so
  /// the file path is the normal case; the http(s) branch is defensive.
  ///
  /// `unlitColor`: every material is replaced with a flat UnlitMaterial of THIS
  /// colour. IFC GLBs carry no normals/materials, and even the edge-tube GLB's
  /// baked emissive material gets SHADED by RealityKit's lighting (so the lines
  /// look gradient-tinted across the assembly). A flat unlit override gives one
  /// uniform colour with zero lighting variation — grey for the solid model, the
  /// chosen edge colour for the wireframe.
  static func load(from uri: URL, unlitColor: UIColor) async throws -> Entity {
    let localURL: URL
    if uri.isFileURL {
      localURL = uri
    } else {
      let (tmp, _) = try await URLSession.shared.download(from: uri)
      let dest = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString + ".glb")
      try? FileManager.default.removeItem(at: dest)
      try FileManager.default.moveItem(at: tmp, to: dest)
      localURL = dest
    }

    // Direct glTF → Entity (parses synchronously inside, converts on @MainActor).
    let entity = try await GLTFRealityKitLoader.load(from: localURL)
    await MainActor.run {
      applyUnlitColor(entity, unlitColor)
      normalizeSize(entity, target: 0.6)
    }
    return entity
  }

  // IFC GLBs arrive in arbitrary units (often mm), so a model can be invisibly
  // huge or tiny. Scale uniformly so the longest dimension is ~`target` metres —
  // the RealityKit analog of the Viro path's bounding-box auto-fit.
  @MainActor
  private static func normalizeSize(_ entity: Entity, target: Float) {
    let b = entity.visualBounds(relativeTo: nil)
    let longest = max(b.extents.x, max(b.extents.y, b.extents.z))
    if longest > 0, longest.isFinite {
      entity.scale = SIMD3<Float>(repeating: target / longest)
    }
  }

  // IFC-converted GLBs carry NO materials and NO vertex normals. GLTFKit2 does
  // not synthesize normals, so under RealityKit's PBR lighting the surface can
  // render flat/black, and a baked emissive (the edge tubes) gets shaded into a
  // gradient. An UNLIT flat material does not depend on normals or lighting — so
  // every mesh shows ONE uniform colour. Reused at runtime to re-tint the edge
  // view when the colour changes (see PcsLidarArView.retint).
  @MainActor
  static func applyUnlitColor(_ entity: Entity, _ color: UIColor) {
    let flat = UnlitMaterial(color: color)
    func walk(_ e: Entity) {
      if var model = e.components[ModelComponent.self] {
        let count = max(model.materials.count, 1)
        model.materials = Array(repeating: flat, count: count)
        e.components.set(model)
      }
      for child in e.children { walk(child) }
    }
    walk(entity)
  }
}
#endif
