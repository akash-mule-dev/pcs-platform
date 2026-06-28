/**
 * IFC to GLB conversion script.
 *
 * Uses web-ifc to parse IFC files and builds a binary GLB (glTF 2.0) buffer
 * from the extracted geometry.
 *
 * Usage: node convert-ifc.mjs <input.ifc> <output.glb>
 */
import * as WebIFC from 'web-ifc';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { buildGLB } from './glb-build.mjs';

const [,, inputPath, outputPath] = process.argv;

if (!inputPath || !outputPath) {
  console.error('Usage: convert-ifc.mjs <input.ifc> <output.glb>');
  process.exit(1);
}

// ── Main conversion ──────────────────────────────────────────────────────

async function main() {
  console.log(`Loading IFC file: ${inputPath}`);

  const ifcApi = new WebIFC.IfcAPI();

  // Locate WASM files from the web-ifc package
  const require = createRequire(import.meta.url);
  const wasmDir = path.dirname(require.resolve('web-ifc/web-ifc.wasm'));
  const wasmPath = wasmDir.replace(/\\/g, '/') + '/';
  console.log(`WASM path: ${wasmPath}`);
  ifcApi.SetWasmPath(wasmPath, true);

  await ifcApi.Init();

  const fileData = fs.readFileSync(inputPath);
  const modelID = ifcApi.OpenModel(fileData);

  console.log(`IFC model opened (ID: ${modelID}), extracting geometry...`);

  const meshes = [];

  // Iterate all meshes from the IFC model
  const flatMeshes = ifcApi.LoadAllGeometry(modelID);
  console.log(`Found ${flatMeshes.size()} geometric elements`);

  for (let i = 0; i < flatMeshes.size(); i++) {
    const flatMesh = flatMeshes.get(i);
    const expressID = flatMesh.expressID;

    // Get element type/name for node naming
    let name = `ifc_${expressID}`;
    try {
      const line = ifcApi.GetLine(modelID, expressID);
      // Name GLB nodes by GlobalId so the structure tree (assembly_nodes.ifcGuid)
      // can address/highlight a specific mesh; fall back to Name.
      if (line && line.GlobalId && line.GlobalId.value) {
        name = line.GlobalId.value;
      } else if (line && line.Name && line.Name.value) {
        name = line.Name.value;
      }
    } catch { /* skip name lookup errors */ }

    // Collect vertices and indices from all placements of this element
    const allVerts = [];
    const allIndices = [];

    for (let j = 0; j < flatMesh.geometries.size(); j++) {
      const placedGeom = flatMesh.geometries.get(j);
      const geom = ifcApi.GetGeometry(modelID, placedGeom.geometryExpressID);

      const vData = ifcApi.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
      const iData = ifcApi.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());

      // web-ifc vertices are interleaved: x,y,z, nx,ny,nz per vertex (6 floats)
      // We extract only positions (x,y,z) for now
      const transform = placedGeom.flatTransformation;

      const baseIndex = allVerts.length / 3;
      for (let v = 0; v < vData.length; v += 6) {
        let x = vData[v], y = vData[v + 1], z = vData[v + 2];

        // Apply 4x4 transformation matrix (column-major)
        const tx = transform[0] * x + transform[4] * y + transform[8] * z + transform[12];
        const ty = transform[1] * x + transform[5] * y + transform[9] * z + transform[13];
        const tz = transform[2] * x + transform[6] * y + transform[10] * z + transform[14];

        allVerts.push(tx, ty, tz);
      }

      for (let idx = 0; idx < iData.length; idx++) {
        allIndices.push(iData[idx] + baseIndex);
      }

      geom.delete();
    }

    if (allVerts.length > 0 && allIndices.length > 0) {
      meshes.push({ name, vertices: allVerts, indices: allIndices });
    }
  }

  console.log(`Extracted ${meshes.length} meshes, building GLB...`);

  ifcApi.CloseModel(modelID);

  const glb = buildGLB(meshes);
  fs.writeFileSync(outputPath, glb);

  console.log(`GLB written: ${outputPath} (${(glb.length / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch((err) => {
  console.error(`IFC conversion error: ${err.message || err}`);
  process.exit(1);
});
