/**
 * Shared opencascade.js (OpenCASCADE WASM) loader for the spawned CAD scripts.
 *
 * The published opencascade.js@2-beta entry point is written for bundlers (it
 * `import`s .wasm files as URLs) and its emscripten glue is a hybrid CJS/ESM
 * file Node refuses to load directly. We therefore:
 *   1. require() the emscripten glue through a tiny CJS shim (swap its single
 *      `export default` line for `module.exports`),
 *   2. delete the global `fetch` so the glue uses Node's filesystem reader
 *      instead of trying to fetch the wasm by file path ("unknown scheme"),
 *   3. feed the main module's bytes via `wasmBinary`, and
 *   4. load the OCCT feature bundles (core + modeling + dataExchange) as
 *      dynamic libraries — the customizable build has no symbols without them.
 *
 * dataExchangeBase/Extra carry the STEP/IGES readers, the XDE (XCAF) document
 * model used for assembly-structure extraction, and the RWGltf glTF writer.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/** Load opencascade.js (the customizable WASM build) under Node. */
export async function loadOpenCascade() {
  // Node 18+ exposes a global `fetch`; the emscripten glue then tries to fetch
  // the wasm by FILE PATH and dies with "unknown scheme". Removing it forces
  // the Node filesystem (readBinary) path for the main module + every dynlib.
  delete globalThis.fetch;

  const gluePath = require.resolve('opencascade.js/dist/opencascade.js');
  const dist = path.dirname(gluePath);

  // The glue ends in `export default Module;` (ESM) yet uses __dirname/require
  // (CJS) — an ambiguous hybrid Node won't load. Rewrite that one line to CJS
  // and require it from a cached temp shim.
  const src = fs
    .readFileSync(gluePath, 'utf8')
    .replace(/export default Module;\s*$/, 'module.exports = Module;');
  const shimPath = path.join(os.tmpdir(), 'pcs-oc-glue.cjs');
  if (!fs.existsSync(shimPath) || fs.readFileSync(shimPath, 'utf8') !== src) {
    fs.writeFileSync(shimPath, src);
  }
  const factory = require(shimPath);

  const resolveWasm = (p) => {
    const full = path.join(dist, path.basename(p));
    return fs.existsSync(full) ? full : p;
  };
  const oc = await new factory({
    locateFile: (p) => (p.endsWith('.wasm') ? resolveWasm(p) : p),
    wasmBinary: fs.readFileSync(path.join(dist, 'opencascade.wasm')),
  });

  // OCCT feature bundles, loaded in dependency order. dataExchange* carries the
  // STEP/IGES readers, the XDE/XCAF document model + the RWGltf writer.
  const libs = [
    'opencascade.core.wasm',
    'opencascade.modelingAlgorithms.wasm',
    'opencascade.visualApplication.wasm',
    'opencascade.dataExchangeBase.wasm',
    'opencascade.dataExchangeExtra.wasm',
  ].map((f) => path.join(dist, f));
  for (const lib of libs) {
    await oc.loadDynamicLibrary(lib, { loadAsync: false, global: true, nodelete: true, allowUndefined: false });
  }
  return oc;
}
