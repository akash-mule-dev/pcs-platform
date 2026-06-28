import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import * as path from 'path';
import * as fs from 'fs';
const require = createRequire(import.meta.url);
const D = (n) => require.resolve('opencascade.js/dist/' + n);
globalThis.require = require;
globalThis.__dirname = path.dirname(D('opencascade.js'));
globalThis.__filename = D('opencascade.js');
globalThis.WebAssembly.instantiateStreaming = undefined;
globalThis.fetch = async (url) => {
  let p = typeof url === 'string' ? url : (url?.href ?? String(url));
  if (p.startsWith('file://')) p = fileURLToPath(p);
  const buf = fs.readFileSync(p);
  return { ok: true, status: 200, url: p, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};
const { default: mainJS } = await import('opencascade.js/dist/opencascade.js');
const t0 = Date.now();
const oc = await new mainJS({ wasmBinary: fs.readFileSync(D('opencascade.wasm')), locateFile: (p) => p });
// full granular load order (from index.d.ts)
const ORDER = ['TKMath','TKG2d','TKG3d','TKService','TKGeomBase','TKBRep','TKGeomAlgo','TKTopAlgo','TKHLR','TKShHealing','TKMesh','TKV3d','TKXSBase','TKSTEPBase','TKSTEP209','TKSTEPAttr','TKCDF','TKSTEP','TKLCAF','TKPrim','TKBO','TKCAF','TKVCAF','TKXCAF','TKXDESTEP','TKRWMesh','TKBool','TKFillet','TKFeat','TKIGES','TKOffset','TKXDEIGES'];
for (const m of ORDER) {
  await oc.loadDynamicLibrary(D('module.' + m + '.wasm'), { loadAsync: true, global: true, nodelete: true, allowUndefined: true });
}
const dt = ((Date.now()-t0)/1000).toFixed(1);
const have = (k) => typeof oc[k] !== 'undefined';
console.log(`LOADED ${ORDER.length} modules in ${dt}s`);
console.log('IGES:', have('IGESControl_Reader_1'), 'STEP:', have('STEPControl_Reader_1'),
  'Mesh:', have('BRepMesh_IncrementalMesh_2'), 'Gltf:', have('RWGltf_CafWriter'),
  'Doc:', have('TDocStd_Document'), 'XCAF:', have('XCAFDoc_DocumentTool'),
  'AsciiStr2:', have('TCollection_AsciiString_2'), 'ExtStr1:', have('TCollection_ExtendedString_1'),
  'ProgRange:', have('Message_ProgressRange_1'), 'IdxMap:', have('TColStd_IndexedDataMapOfStringString_1'));
