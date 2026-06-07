/**
 * GLB optimization + AR normalization for AR / web / app using @gltf-transform.
 *
 * DEFAULT ops are decoder-agnostic — the output is plain glTF that Viro,
 * <model-viewer> and three.js all load with no special loader:
 *   dedup -> prune -> weld -> simplify (meshoptimizer) -> texture resize+webp (sharp)
 *
 * AR NORMALIZATION (always applied):
 *   - scale source units -> METRES (glTF's canonical unit) so the model is the
 *     correct real-world size in AR. Steel CAD is usually millimetres.
 *   - rotate Z-up (CAD/IFC) -> Y-up (glTF convention) so it stands upright.
 *   - report the real-world bounding-box dimensions (metres).
 *
 * OPT-IN ops add KHR extensions that need decoder support (safe for the web
 * portal's <model-viewer>, not assumed for Viro): quantize, draco.
 *
 * Usage: node optimize-glb.mjs <input> <output> '<jsonOptions>'
 * Emits one JSON report line on stdout, e.g.
 *   {"trianglesBefore":N,"trianglesAfter":M,"bytesBefore":..,"bytesAfter":..,
 *    "dimensions":{"x":..,"y":..,"z":..},"sourceUnit":"mm","upAxis":"Z"}
 */
import * as fs from 'fs';
import { NodeIO } from '@gltf-transform/core';
import * as GLTFCore from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, textureCompress, quantize } from '@gltf-transform/functions';

const [, , inputPath, outputPath, optionsJson] = process.argv;
if (!inputPath || !outputPath) {
  console.error('Usage: optimize-glb.mjs <input> <output> [jsonOptions]');
  process.exit(1);
}

const opts = optionsJson ? JSON.parse(optionsJson) : {};
const simplifyRatio = typeof opts.simplifyRatio === 'number' ? opts.simplifyRatio : 1.0;
const maxTexture = typeof opts.maxTexture === 'number' ? opts.maxTexture : 2048;
const useDraco = !!opts.draco;
const useQuantize = !!opts.quantize;
const sourceUnit = String(opts.sourceUnit || 'm').toLowerCase();
const upAxis = String(opts.upAxis || 'Y').toUpperCase();

// Metres per source unit. Steel CAD/IFC is typically millimetres.
const UNIT_TO_M = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, ft: 0.3048 };

// getBounds (v4) / bounds (older) — accessed defensively so a name change can't crash the script.
const getBoundsFn = GLTFCore.getBounds || GLTFCore.bounds || null;

function countTriangles(document) {
  let tris = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      const position = prim.getAttribute('POSITION');
      if (indices) tris += indices.getCount() / 3;
      else if (position) tris += position.getCount() / 3;
    }
  }
  return Math.round(tris);
}

/** Reparent the scene under a single node that applies unit scale + up-axis fix. */
function normalizeScene(document, scaleFactor, rotateZtoY) {
  if ((!scaleFactor || scaleFactor === 1) && !rotateZtoY) return;
  const root = document.getRoot();
  const scene = root.getDefaultScene() || root.listScenes()[0];
  if (!scene) return;
  const wrapper = document.createNode('AR_Normalize');
  if (scaleFactor && scaleFactor !== 1) wrapper.setScale([scaleFactor, scaleFactor, scaleFactor]);
  // -90° about X converts Z-up (CAD/IFC) to Y-up (glTF).
  if (rotateZtoY) wrapper.setRotation([-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    wrapper.addChild(child);
  }
  scene.addChild(wrapper);
}

/** World-space bounding-box dimensions of the (normalized) scene, in metres. */
function sceneDimensions(document) {
  if (!getBoundsFn) return null;
  try {
    const root = document.getRoot();
    const scene = root.getDefaultScene() || root.listScenes()[0];
    if (!scene) return null;
    const b = getBoundsFn(scene);
    if (!b || !b.min || !b.max) return null;
    const round = (n) => Math.round(n * 10000) / 10000;
    return { x: round(b.max[0] - b.min[0]), y: round(b.max[1] - b.min[1]), z: round(b.max[2] - b.min[2]) };
  } catch (e) {
    console.error(`[optimize] dimensions skipped: ${(e && e.message) || e}`);
    return null;
  }
}

async function main() {
  const bytesBefore = fs.statSync(inputPath).size;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

  const document = await io.read(inputPath);
  const trianglesBefore = countTriangles(document);

  const transforms = [dedup(), prune(), weld()];

  if (simplifyRatio > 0 && simplifyRatio < 1.0) {
    try {
      const { MeshoptSimplifier } = await import('meshoptimizer');
      await MeshoptSimplifier.ready;
      transforms.push(simplify({ simplifier: MeshoptSimplifier, ratio: simplifyRatio, error: 0.001 }));
    } catch (e) {
      console.error(`[optimize] simplify skipped (meshoptimizer unavailable): ${(e && e.message) || e}`);
    }
  }

  try {
    const sharp = (await import('sharp')).default;
    transforms.push(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [maxTexture, maxTexture] }));
  } catch (e) {
    console.error(`[optimize] texture compression skipped (sharp unavailable): ${(e && e.message) || e}`);
  }

  if (useQuantize) transforms.push(quantize());

  await document.transform(...transforms);
  const trianglesAfter = countTriangles(document);

  // AR normalization (units -> metres, up-axis -> Y), then measure real-world size.
  const scaleFactor = UNIT_TO_M[sourceUnit] ?? 1;
  normalizeScene(document, scaleFactor, upAxis === 'Z');
  const dimensions = sceneDimensions(document);

  if (useDraco) {
    try {
      const draco3dMod = await import('draco3dgltf');
      const draco3d = draco3dMod.default ?? draco3dMod;
      io.registerDependencies({ 'draco3d.encoder': await draco3d.createEncoderModule() });
      document.createExtension(KHRDracoMeshCompression).setRequired(true);
    } catch (e) {
      console.error(`[optimize] draco skipped (encoder unavailable): ${(e && e.message) || e}`);
    }
  }

  await io.write(outputPath, document);
  const bytesAfter = fs.statSync(outputPath).size;
  console.log(JSON.stringify({
    trianglesBefore, trianglesAfter, bytesBefore, bytesAfter, dimensions, sourceUnit, upAxis,
  }));
}

main().catch((err) => {
  console.error(`optimize error: ${(err && (err.stack || err.message)) || err}`);
  process.exit(1);
});
