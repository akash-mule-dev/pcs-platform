/**
 * Package-import classification — pure module (no Nest/TypeORM, unit-testable).
 *
 * Industry packages (Tekla/SDS2/Advance Steel exports) arrive as ZIPs holding
 * one or more IFC models plus per-mark PDF shop drawings (and KISS/.kss data,
 * occasionally DWG/DXF). This module decides what each member is and matches
 * drawing filenames to piece marks ("B101 - Rev 0.pdf" → mark B101).
 */

/** Model formats that produce an assembly tree (structure extraction). */
export const MODEL_EXTS = new Set(['ifc']);
/**
 * STEP carries a product/assembly structure (PRODUCT + NEXT_ASSEMBLY_USAGE_
 * OCCURRENCE) that the XDE reader can recover, so it gets an assembly tree +
 * a node-named GLB (convert-step.mjs) rather than a flattened geometry-only GLB.
 * IGES has no such structure, so it stays geometry-only.
 */
export const STRUCTURED_CAD_EXTS = new Set(['step', 'stp']);
/** Geometry-only formats the conversion pipeline can turn into a GLB. */
export const GEOMETRY_EXTS = new Set(['step', 'stp', 'iges', 'igs', 'glb', 'gltf', 'obj', 'stl', 'dae', 'fbx', '3ds', 'ply']);
/** Document formats worth keeping from a package (drawings, certs, NC data). */
export const DOCUMENT_EXTS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'webp', 'dwg', 'dxf']);
/**
 * Native fabrication-detailing outputs that carry an assembly/parts structure:
 * DSTV NC/NC1 (one part per file), SDNF (whole structural model) and KISS (a
 * bill of materials). Parsed by the dstv/sdnf/kiss parsers + fab-extract, which
 * also synthesize approximate GLB geometry so the pieces render in the viewer.
 */
export const FAB_EXTS = new Set(['nc1', 'nc', 'sdnf', 'kss']);

/** Every single-file upload format the import endpoint accepts. */
export const ACCEPTED_UPLOAD_EXTS = ['ifc', 'zip', ...GEOMETRY_EXTS, ...FAB_EXTS];

export const DOC_CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  dwg: 'application/octet-stream',
  dxf: 'application/octet-stream',
  kss: 'application/octet-stream',
};

export function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}

export interface PackageEntryIn { path: string; size: number; }
export interface ClassifiedPackage {
  models: PackageEntryIn[];      // IFCs, largest first (the primary drives the GLB)
  geometry: PackageEntryIn[];    // STEP/IGES/…, largest first (fallback when no IFC)
  fabrication: PackageEntryIn[]; // DSTV/SDNF/KISS (used for the tree when no IFC/STEP)
  documents: PackageEntryIn[];   // drawings / certs
  skipped: PackageEntryIn[];     // everything else
}

/** Split a ZIP's member list into models / geometry / documents / skipped. */
export function classifyPackageEntries(entries: PackageEntryIn[]): ClassifiedPackage {
  const out: ClassifiedPackage = { models: [], geometry: [], fabrication: [], documents: [], skipped: [] };
  for (const e of entries) {
    const base = e.path.split('/').pop() ?? '';
    if (!base || e.path.endsWith('/')) continue; // directory
    if (base.startsWith('.') || base.startsWith('__MACOSX')) { out.skipped.push(e); continue; }
    const ext = extOf(base);
    if (MODEL_EXTS.has(ext)) out.models.push(e);
    else if (GEOMETRY_EXTS.has(ext)) out.geometry.push(e);
    else if (FAB_EXTS.has(ext)) out.fabrication.push(e);
    else if (DOCUMENT_EXTS.has(ext)) out.documents.push(e);
    else out.skipped.push(e);
  }
  out.models.sort((a, b) => b.size - a.size);
  out.geometry.sort((a, b) => b.size - a.size);
  out.fabrication.sort((a, b) => b.size - a.size);
  return out;
}

/**
 * Candidate piece marks a drawing filename might refer to, most-specific
 * first. "B101 - Rev 0.pdf" → ["B101"]; "4207C1-R0.pdf" → ["4207C1"];
 * "D1000 - BRACE - Rev 0.pdf" → ["D1000"].
 */
export function drawingMarkCandidates(fileName: string): string[] {
  const base = (fileName.split('/').pop() ?? fileName).replace(/\.[a-z0-9]+$/i, '').trim();
  const out: string[] = [];
  const push = (s: string) => {
    const v = s.trim().toUpperCase();
    if (v && !out.includes(v)) out.push(v);
  };
  push(base.split(' - ')[0]);            // "B101 - Rev 0" → B101
  push(base.replace(/-R\d+[A-Z]?$/i, '')); // "4207C1-R0" → 4207C1
  push(base.split(/[\s_]/)[0]);          // "B101_sheet2" → B101
  push(base);                            // exact stem as last resort
  return out;
}

/**
 * Match drawings to marks. `marks` maps UPPERCASED mark → nodeId. Returns the
 * nodeId per file (null = keep at project level).
 */
export function matchDrawingsToMarks(
  fileNames: string[],
  marks: Map<string, string>,
): Map<string, string | null> {
  const result = new Map<string, string | null>();
  for (const f of fileNames) {
    let matched: string | null = null;
    for (const cand of drawingMarkCandidates(f)) {
      const nodeId = marks.get(cand);
      if (nodeId) { matched = nodeId; break; }
    }
    result.set(f, matched);
  }
  return result;
}

/** Human summary for the import event timeline. */
export function packageSummaryMessage(c: ClassifiedPackage, matchedDocs: number): string {
  const bits: string[] = [];
  if (c.models.length) bits.push(`${c.models.length} model${c.models.length > 1 ? 's' : ''}`);
  if (c.geometry.length) bits.push(`${c.geometry.length} geometry file${c.geometry.length > 1 ? 's' : ''}`);
  if (c.fabrication.length) bits.push(`${c.fabrication.length} fabrication file${c.fabrication.length > 1 ? 's' : ''}`);
  if (c.documents.length) bits.push(`${c.documents.length} document${c.documents.length > 1 ? 's' : ''}${matchedDocs > 0 ? ` (${matchedDocs} matched to piece marks)` : ''}`);
  if (c.skipped.length) bits.push(`${c.skipped.length} skipped`);
  return `Package unpacked: ${bits.join(', ') || 'no usable files'}`;
}
