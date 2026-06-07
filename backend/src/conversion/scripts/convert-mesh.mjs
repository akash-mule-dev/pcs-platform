/**
 * Mesh / DCC -> GLB conversion using assimpjs (WASM, 40+ importers).
 *
 * Handles OBJ, FBX, DAE/COLLADA, STL, PLY, 3DS, glTF and more. Runs as an
 * isolated child process (matches the OpenCASCADE/web-ifc converters) so a
 * crashing WASM module never takes down the API/worker.
 *
 * Usage: node convert-mesh.mjs <input> <output>
 */
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';

const require = createRequire(import.meta.url);
const assimpjs = require('assimpjs');

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error('Usage: convert-mesh.mjs <input> <output>');
  process.exit(1);
}

assimpjs()
  .then((ajs) => {
    const fileName = path.basename(inputPath);
    const fileList = new ajs.FileList();
    fileList.AddFile(fileName, fs.readFileSync(inputPath));

    // Best-effort: include companion files (e.g. .mtl, .bin) if they were
    // staged next to the input. The single-upload flow usually has none.
    try {
      const dir = path.dirname(inputPath);
      for (const sibling of fs.readdirSync(dir)) {
        if (sibling === fileName) continue;
        if (['.mtl', '.bin'].includes(path.extname(sibling).toLowerCase())) {
          fileList.AddFile(sibling, fs.readFileSync(path.join(dir, sibling)));
        }
      }
    } catch {
      /* ignore companion-file discovery errors */
    }

    const result = ajs.ConvertFileList(fileList, 'glb2');
    if (!result.IsSuccess() || result.FileCount() === 0) {
      const code = typeof result.GetErrorCode === 'function' ? result.GetErrorCode() : 'unknown';
      console.error(`assimp conversion failed (error: ${code})`);
      process.exit(2);
    }

    const buf = Buffer.from(result.GetFile(0).GetContent());
    if (buf.slice(0, 4).toString('ascii') !== 'glTF') {
      console.error('assimp produced a non-GLB output');
      process.exit(3);
    }

    fs.writeFileSync(outputPath, buf);
    console.log(`mesh conversion complete: ${outputPath} (${buf.length} bytes)`);
  })
  .catch((err) => {
    console.error(`mesh conversion error: ${(err && err.message) || err}`);
    process.exit(1);
  });
