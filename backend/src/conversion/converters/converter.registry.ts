import * as path from 'path';

export type ConverterKind = 'cad' | 'mesh' | 'passthrough';

/** STEP/IGES + IFC are handled by the existing CadConversionService. */
const CAD_EXTS = ['.step', '.stp', '.iges', '.igs', '.ifc'];
/** Mesh/DCC formats handled by the new assimp converter. */
const MESH_EXTS = ['.obj', '.fbx', '.dae', '.stl', '.ply', '.3ds', '.gltf'];
/** Already GLB — skip conversion, go straight to optimization. */
const PASSTHROUGH_EXTS = ['.glb'];

export const SUPPORTED_INPUT_EXTS: string[] = [
  ...CAD_EXTS,
  ...MESH_EXTS,
  ...PASSTHROUGH_EXTS,
];

export function extOf(filename: string): string {
  return path.extname(filename).toLowerCase();
}

export function isSupportedInput(filename: string): boolean {
  return SUPPORTED_INPUT_EXTS.includes(extOf(filename));
}

export function converterFor(filename: string): ConverterKind {
  const ext = extOf(filename);
  if (CAD_EXTS.includes(ext)) return 'cad';
  if (MESH_EXTS.includes(ext)) return 'mesh';
  if (PASSTHROUGH_EXTS.includes(ext)) return 'passthrough';
  throw new Error(`Unsupported input format: ${ext || '(none)'}`);
}

/** Human-readable catalogue for the GET /formats endpoint. */
export const SUPPORTED_FORMATS = [
  { extension: '.ifc', description: 'IFC — BIM / structural steel (Tekla, Advance Steel, SDS/2)' },
  { extension: '.step', description: 'STEP — Standard for the Exchange of Product Data' },
  { extension: '.stp', description: 'STEP (alternate extension)' },
  { extension: '.iges', description: 'IGES — Initial Graphics Exchange Specification' },
  { extension: '.igs', description: 'IGES (alternate extension)' },
  { extension: '.obj', description: 'Wavefront OBJ (Navisworks, SketchUp, viewers)' },
  { extension: '.fbx', description: 'Autodesk FBX (3ds Max, Navisworks)' },
  { extension: '.dae', description: 'COLLADA (SketchUp, exchange)' },
  { extension: '.stl', description: 'STL (mesh / 3D print / scans)' },
  { extension: '.ply', description: 'PLY (scans / point-derived meshes)' },
  { extension: '.3ds', description: '3DS (legacy 3ds Max)' },
  { extension: '.gltf', description: 'glTF (text) — re-optimized to GLB' },
  { extension: '.glb', description: 'GLB — optimized only (already binary glTF)' },
];
