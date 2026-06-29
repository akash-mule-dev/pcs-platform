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
const __realInstantiate = WebAssembly.instantiate.bind(WebAssembly);
WebAssembly.instantiate = (bin, imports) => {
  if (imports && imports.env) {
    if (typeof imports.env.getpwuid !== "undefined") imports.env.getpwuid = () => 0;
    if (typeof imports.env.getpwuid_r !== "undefined") imports.env.getpwuid_r = () => 0;
  }
  return __realInstantiate(bin, imports);
};
globalThis.fetch = async (url) => {
  let p = typeof url === 'string' ? url : (url?.href ?? String(url));
  if (p.startsWith('file://')) p = fileURLToPath(p);
  const buf = fs.readFileSync(p);
  return { ok: true, status: 200, url: p, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};
const { default: mainJS } = await import('opencascade.js/dist/opencascade.js');
const oc = await new mainJS({ wasmBinary: fs.readFileSync(D('opencascade.wasm')), locateFile: (p) => p });
try { oc.FS.mkdir('/home'); } catch {}
if (oc.ENV) { oc.ENV.HOME = '/home'; oc.ENV.USER = 'occ'; oc.ENV.LOGNAME = 'occ'; oc.ENV.TMPDIR = '/tmp'; }
const ORDER = ['TKMath','TKG2d','TKG3d','TKService','TKGeomBase','TKBRep','TKGeomAlgo','TKTopAlgo','TKHLR','TKShHealing','TKMesh','TKV3d','TKXSBase','TKSTEPBase','TKSTEP209','TKSTEPAttr','TKCDF','TKSTEP','TKLCAF','TKPrim','TKBO','TKCAF','TKVCAF','TKXCAF','TKXDESTEP','TKRWMesh','TKBool','TKFillet','TKFeat','TKIGES','TKOffset','TKXDEIGES'];
for (const m of ORDER) await oc.loadDynamicLibrary(D('module.' + m + '.wasm'), { loadAsync: true, global: true, nodelete: true, allowUndefined: true });

const [inputPath, outputPath, format] = process.argv.slice(2);
const fileName = path.basename(inputPath);
oc.FS.writeFile(`/${fileName}`, fs.readFileSync(inputPath));
const fmt = (format || path.extname(inputPath)).toLowerCase().replace('.', '');
let shape;
if (fmt === 'step' || fmt === 'stp') {
  const r = new oc.STEPControl_Reader_1();
  if (r.ReadFile(`/${fileName}`) !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) throw new Error('read STEP failed');
  r.TransferRoots(new oc.Message_ProgressRange_1()); shape = r.OneShape(); r.delete();
} else {
  const r = new oc.IGESControl_Reader_1();
  if (r.ReadFile(`/${fileName}`) !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) throw new Error('read IGES failed');
  r.TransferRoots(new oc.Message_ProgressRange_1()); shape = r.OneShape(); r.delete();
}
console.log('shape read, null?', shape.IsNull());
new oc.BRepMesh_IncrementalMesh_2(shape, 0.1, false, 0.5, false);
const doc = new oc.TDocStd_Document(new oc.TCollection_ExtendedString_1());
const shapeTool = oc.XCAFDoc_DocumentTool.ShapeTool(doc.Main()).get();
shapeTool.AddShape(shape, true, true);
const writer = new oc.RWGltf_CafWriter(new oc.TCollection_AsciiString_2(`/${path.basename(outputPath)}`), true);
const docHandle = new oc.Handle_TDocStd_Document_2(doc);
writer.Perform_2(docHandle, new oc.TColStd_IndexedDataMapOfStringString_1(), new oc.Message_ProgressRange_1());
const out = oc.FS.readFile(`/${path.basename(outputPath)}`);
fs.writeFileSync(outputPath, Buffer.from(out));
console.log('GLB written:', out.length, 'bytes');
