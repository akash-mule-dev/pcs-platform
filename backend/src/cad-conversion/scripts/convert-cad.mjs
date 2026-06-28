/**
 * CAD to GLB conversion script (geometry-only, flattened).
 *
 * Uses opencascade.js (OpenCASCADE compiled to WASM) to read STEP/IGES files
 * and export them to GLB via triangulation + an XDE/glTF writer. This path
 * collapses the model into a single shape (no assembly tree) — for STEP files
 * that carry product structure, convert-step.mjs extracts the tree instead.
 *
 * Usage: node convert-cad.mjs <input> <output> <format>
 */
import * as fs from 'fs';
import * as path from 'path';
import { loadOpenCascade } from './oc-loader.mjs';

const [, , inputPath, outputPath, format] = process.argv;

if (!inputPath || !outputPath) {
  console.error('Usage: convert-cad.mjs <input> <output> <format>');
  process.exit(1);
}

async function main() {
  const oc = await loadOpenCascade();

  // Read the input CAD file into OpenCASCADE's virtual filesystem.
  const fileData = fs.readFileSync(inputPath);
  const fileName = path.basename(inputPath);
  oc.FS.writeFile(`/${fileName}`, fileData);

  let shape;
  const fmt = (format || path.extname(inputPath)).toLowerCase().replace('.', '');

  if (fmt === 'step' || fmt === 'stp') {
    const reader = new oc.STEPControl_Reader_1();
    const readResult = reader.ReadFile(`/${fileName}`);
    if (readResult !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
      throw new Error(`Failed to read STEP file (status: ${readResult})`);
    }
    reader.TransferRoots(new oc.Message_ProgressRange_1());
    shape = reader.OneShape();
    reader.delete();
  } else if (fmt === 'iges' || fmt === 'igs') {
    const reader = new oc.IGESControl_Reader_1();
    const readResult = reader.ReadFile(`/${fileName}`);
    if (readResult !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
      throw new Error(`Failed to read IGES file (status: ${readResult})`);
    }
    reader.TransferRoots(new oc.Message_ProgressRange_1());
    shape = reader.OneShape();
    reader.delete();
  } else {
    throw new Error(`Unsupported CAD format: ${fmt}`);
  }

  if (shape.IsNull && shape.IsNull()) {
    throw new Error('The CAD file produced no geometry (empty or unsupported shape)');
  }

  // Mesh the shape (triangulation) so it can be tessellated to glTF.
  const linDeflection = 0.1;
  const angDeflection = 0.5;
  new oc.BRepMesh_IncrementalMesh_2(shape, linDeflection, false, angDeflection, false);

  // Export to GLB via the XDE document + RWGltf writer.
  const doc = new oc.TDocStd_Document(new oc.TCollection_ExtendedString_1());
  const shapeTool = oc.XCAFDoc_DocumentTool.ShapeTool(doc.Main()).get();
  shapeTool.AddShape(shape, true, true);

  const writer = new oc.RWGltf_CafWriter(
    new oc.TCollection_AsciiString_2(`/${path.basename(outputPath)}`),
    true, // binary GLB
  );
  // Perform expects a Handle(TDocStd_Document), not the raw document.
  const docHandle = new oc.Handle_TDocStd_Document_2(doc);
  writer.Perform_2(docHandle, new oc.TColStd_IndexedDataMapOfStringString_1(), new oc.Message_ProgressRange_1());

  // Read the output back out of the virtual filesystem.
  const outputData = oc.FS.readFile(`/${path.basename(outputPath)}`);
  fs.writeFileSync(outputPath, Buffer.from(outputData));

  doc.delete();
  shape.delete();

  console.log(`Conversion complete: ${outputPath}`);
}

main().catch((err) => {
  console.error(`Conversion error: ${err.message || err}`);
  process.exit(1);
});
