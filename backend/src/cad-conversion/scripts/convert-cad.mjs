/**
 * CAD to GLB conversion script.
 *
 * Uses opencascade.js (WASM) to read STEP/IGES files and exports to GLB via
 * a triangulation + glTF buffer build.
 *
 * Usage: node --experimental-wasm-threads convert-cad.mjs <input> <output> <format>
 */
import opencascade from 'opencascade.js';
import * as fs from 'fs';
import * as path from 'path';

const [,, inputPath, outputPath, format] = process.argv;

if (!inputPath || !outputPath) {
  console.error('Usage: convert-cad.mjs <input> <output> <format>');
  process.exit(1);
}

async function main() {
  const oc = await opencascade();

  // Read the input CAD file
  const fileData = fs.readFileSync(inputPath);
  const fileName = path.basename(inputPath);

  // Write file to OpenCASCADE virtual filesystem
  oc.FS.writeFile(`/${fileName}`, fileData);

  let shape;

  // Parse based on format
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

  // Mesh the shape (triangulation)
  const linDeflection = 0.1;
  const angDeflection = 0.5;
  new oc.BRepMesh_IncrementalMesh_2(shape, linDeflection, false, angDeflection, false);

  // Export to glTF/GLB using RWGltf_CafWriter
  const doc = new oc.TDocStd_Document(new oc.TCollection_ExtendedString_1());
  const shapeTool = oc.XCAFDoc_DocumentTool.ShapeTool(doc.Main()).get();
  shapeTool.AddShape(shape, true);

  const writer = new oc.RWGltf_CafWriter(
    new oc.TCollection_AsciiString_2(`/${path.basename(outputPath)}`),
    true, // binary GLB
  );

  const progress = new oc.Message_ProgressRange_1();
  writer.Perform_2(doc, new oc.TColStd_IndexedDataMapOfStringString_1(), progress);

  // Read the output from the virtual filesystem
  const outputData = oc.FS.readFile(`/${path.basename(outputPath)}`);
  fs.writeFileSync(outputPath, Buffer.from(outputData));

  // Cleanup
  doc.delete();
  shape.delete();

  console.log(`Conversion complete: ${outputPath}`);
}

main().catch((err) => {
  console.error(`Conversion error: ${err.message || err}`);
  process.exit(1);
});
