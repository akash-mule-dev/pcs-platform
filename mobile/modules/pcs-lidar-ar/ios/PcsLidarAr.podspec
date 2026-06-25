Pod::Spec.new do |s|
  s.name           = 'PcsLidarAr'
  s.version        = '1.0.0'
  s.summary        = 'Native RealityKit LiDAR AR view for PCS (iPad mixed reality).'
  s.description    = 'iPad LiDAR mixed-reality modes — scene mesh, real-world + people occlusion, ' \
                     'plane anchoring, physics — via RealityKit, with optional GLTFKit2 GLB loading.'
  s.author         = 'PCS'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # ── GLTFKit2 (OPTIONAL — for loading real GLB models) ──────────────────────
  # GLTFKit2 is NOT on the CocoaPods trunk (there is no pod), so do NOT add
  # `s.dependency 'GLTFKit2'` — `pod install` would fail. The module compiles
  # WITHOUT it (PcsLidarArView falls back to a placeholder via `#if canImport`).
  #
  # Real GLB loading: GLTFKit2 0.5.15 prebuilt xcframework, vendored here (it is
  # NOT a CocoaPod). Activates GltfModelLoader via `#if canImport(GLTFKit2)`.
  s.vendored_frameworks = 'GLTFKit2.xcframework'

  # Xcode 26's explicitly-built Clang modules choke on GLTFKit2's prebuilt
  # framework headers (duplicate interface / redefinition across module contexts).
  # Fall back to implicit modules for THIS target only — the long-standing, lenient
  # path — so the vendored framework imports cleanly. (Does not affect other pods.)
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
  }
  # Only THIS module's Swift sources (all live directly in ios/). Must NOT use a
  # greedy `**/*.{h,m,swift}` glob — that slurps the vendored GLTFKit2.xcframework's
  # OWN headers into PcsLidarAr-umbrella.h, compiling every GLTFKit2 type twice
  # (pod public header AND framework) → "redefinition" build failures.
  s.source_files = "*.swift"
  s.exclude_files = "GLTFKit2.xcframework/**/*"
end
