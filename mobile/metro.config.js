// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// `@gltf-transform/core` (used by the AR measurement code) depends on
// `property-graph`, which is ESM-only: its package.json exposes an entry point
// *only* via the "exports" field (./dist/index.mjs) with no "main". Metro's
// classic resolver reads "main" and fails to resolve it. Enabling package
// "exports" resolution lets Metro honor that field. (This is the default from
// Expo SDK 53 onward.)
config.resolver.unstable_enablePackageExports = true;

// `@gltf-transform/core` also statically references Node built-ins (node:fs /
// node:path) in its NodeIO code path. The app only ever uses WebIO (in-memory
// GLB bytes — see ar/wireframeGenerator.ts & ar/dimensionExtractor.ts), so that
// path never executes at runtime. React Native has no Node built-ins, so stub
// them to empty modules to let Metro bundle. (Mirrors the package's own
// "browser": { fs: false, path: false } intent, which the node: prefix bypasses.)
const NODE_STUBS = new Set(['fs', 'path', 'node:fs', 'node:path']);
const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (NODE_STUBS.has(moduleName)) {
    return { type: 'empty' };
  }
  const resolve = upstreamResolveRequest ?? context.resolveRequest;
  return resolve(context, moduleName, platform);
};

module.exports = config;
