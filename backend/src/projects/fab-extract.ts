/**
 * Map parsed steel-fabrication formats (DSTV / SDNF / KISS) onto the normalized
 * assembly-tree the import pipeline persists, AND onto a list of "solids" the
 * GLB synthesizer (cad-conversion/scripts/build-fab-glb.mjs) turns into named
 * geometry. Pure module (no Nest/TypeORM) so it is unit-testable in isolation.
 *
 * The node shape mirrors what extract-ifc-structure.mjs emits, so the result
 * flows through the SAME persistExtractResults() / persistTree() path as IFC
 * and STEP. `externalId` (== meshName == assembly_nodes.ifc_guid) is derived
 * deterministically from each piece's identity (mark / member id), so a
 * re-import updates in place (idempotent) instead of duplicating - the same
 * contract the GUID key gives the IFC path.
 */
import type { DstvPart } from './dstv-nc-parser.js';
import type { SdnfModel } from './sdnf-parser.js';
import type { KissModel } from './kiss-parser.js';

export interface FabExtractedNode {
  externalId: string;
  parentExternalId: string | null;
  type: 'group' | 'assembly' | 'subassembly' | 'part';
  ifcClass: string;
  name: string;
  mark: string | null;
  quantity: number;
  profile: string | null;
  materialGrade: string | null;
  lengthMm: number | null;
  weightKg: number | null;
  meshName: string | null;
  depth: number;
  sortIndex: number;
  properties: Record<string, unknown> | null;
}

export interface FabExtractResult {
  format: string;
  rootCount: number;
  nodeCount: number;
  counts: Record<string, number>;
  nodes: FabExtractedNode[];
}

export interface FabSolid {
  meshName: string;
  shape: string; // I|U|L|T|M|RO|RU|B|box
  dims: { h?: number; b?: number; tw?: number; tf?: number; t?: number; d?: number };
  start?: [number, number, number];
  end?: [number, number, number];
  up?: [number, number, number];
  lengthMm?: number;
  polygon?: { vertices: [number, number, number][]; thickness: number };
}

export interface FabBundle {
  result: FabExtractResult;
  solids: FabSolid[];
}

const ROW_GAP_MM = 400;

/** DSTV profile-type code -> GLB cross-section family. */
export function dstvShape(profileType: string | null | undefined): string {
  switch ((profileType || '').toUpperCase()) {
    case 'I': return 'I';
    case 'U': case 'C': return 'U';
    case 'L': return 'L';
    case 'T': return 'T';
    case 'M': return 'M';
    case 'RO': return 'RO';
    case 'RU': return 'RU';
    case 'B': return 'B';
    default: return 'box';
  }
}

/** KISS material type code -> GLB cross-section family. */
export function kissShape(type: string | null | undefined): string {
  switch ((type || '').toUpperCase()) {
    case 'W': case 'M': case 'S': case 'H': case 'HP': return 'I';
    case 'C': case 'MC': return 'U';
    case 'L': return 'L';
    case 'WT': case 'ST': return 'T';
    case 'HSS': return 'M';
    case 'PI': return 'RO';
    case 'RB': case 'CR': return 'RU';
    case 'PL': case 'CP': case 'FB': case 'PV': case 'AR': case 'T1': case 'UM': return 'B';
    default: return 'box';
  }
}

/** Section family from a free section designation (SDNF gives only a name). */
export function shapeFromDesignation(profile: string | null | undefined): string {
  const s = (profile || '').trim().toUpperCase();
  if (!s) return 'box';
  if (/^(W|M|S|HP|HE|HD|IPE|IPN|UB|UC|HEA|HEB|HEM)\b|^W\d|^HE/.test(s)) return 'I';
  if (/^(C|MC|U|PFC|UPN|UPE)\b|^C\d/.test(s)) return 'U';
  if (/^L\b|^L\d/.test(s)) return 'L';
  if (/^(WT|ST|MT|T)\b/.test(s)) return 'T';
  if (/^(HSS|RHS|SHS|TUBE|TS)\b/.test(s)) return 'M';
  if (/^(PIPE|PI|CHS|O)\b/.test(s)) return 'RO';
  if (/^(RB|ROD|DIA|R)\b/.test(s)) return 'RU';
  if (/^(PL|FB|PLATE|FLAT)\b/.test(s)) return 'B';
  return 'box';
}

/**
 * Nominal section depth (mm) parsed from an AISC/EU designation, used only to
 * size approximate geometry for formats that carry no dimensions (SDNF, KISS).
 * "W12X40" -> 12in -> ~305mm ; "W310X..." -> 310mm ; "L3x3x1/4" -> 3in.
 */
export function nominalSectionMm(profile: string | null | undefined): number {
  const s = (profile || '').toUpperCase();
  const m = /(\d+(?:\.\d+)?)/.exec(s.replace(/^[A-Z]+\s*/, ''));
  if (!m) return 150;
  let v = parseFloat(m[1]);
  if (!Number.isFinite(v) || v <= 0) return 150;
  if (v < 60) v *= 25.4; // looks imperial (inches) -> mm
  return Math.min(2000, Math.max(40, v));
}

class Builder {
  nodes: FabExtractedNode[] = [];
  solids: FabSolid[] = [];
  private order = 0;
  private used = new Set<string>();

  key(raw: string): string {
    let k = raw.replace(/\s+/g, '_').slice(0, 60);
    if (!this.used.has(k)) { this.used.add(k); return k; }
    let i = 2;
    while (this.used.has(`${k}#${i}`)) i++;
    k = `${k}#${i}`;
    this.used.add(k);
    return k;
  }

  add(n: Omit<FabExtractedNode, 'sortIndex' | 'meshName'> & { meshName?: string | null }): FabExtractedNode {
    const node: FabExtractedNode = { ...n, meshName: n.meshName ?? n.externalId, sortIndex: this.order++ };
    this.nodes.push(node);
    return node;
  }

  result(format: string): FabExtractResult {
    const counts: Record<string, number> = {};
    for (const n of this.nodes) counts[n.type] = (counts[n.type] ?? 0) + 1;
    const rootCount = this.nodes.filter((n) => n.parentExternalId === null).length;
    return { format, rootCount, nodeCount: this.nodes.length, counts, nodes: this.nodes };
  }
}

/** DSTV: a parts list -> one group with a part per .nc1, laid out in a row. */
export function dstvToExtract(parts: DstvPart[], rootName: string): FabBundle {
  const b = new Builder();
  const rootId = 'dstv-root';
  b.add({
    externalId: rootId, parentExternalId: null, type: 'group', ifcClass: 'DSTV_PACKAGE',
    name: rootName || 'DSTV parts', mark: null, quantity: 1, profile: null, materialGrade: null,
    lengthMm: null, weightKg: null, depth: 0, properties: null,
  });
  let rowY = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const id = b.key(`dstv:${p.mark || 'PART' + (i + 1)}`);
    b.add({
      externalId: id, parentExternalId: rootId, type: 'part', ifcClass: `DSTV_${p.profileType || 'PART'}`,
      name: p.mark || p.profile || `Part ${i + 1}`, mark: p.mark, quantity: p.quantity,
      profile: p.profile, materialGrade: p.grade, lengthMm: p.lengthMm, weightKg: p.weightKg, depth: 1,
      properties: {
        profileType: p.profileType, order: p.order, drawing: p.drawing, phase: p.phase,
        heightMm: p.heightMm, widthMm: p.widthMm, webThicknessMm: p.webThicknessMm,
        flangeThicknessMm: p.flangeThicknessMm, radiusMm: p.radiusMm, weightPerMetre: p.weightPerMetre,
        holeCount: p.holeCount, hasContour: p.hasContour, sourceFormat: 'dstv',
      },
    });
    const dim = Math.max(p.heightMm || 0, p.widthMm || 0, 100);
    const y = rowY + dim / 2;
    rowY += dim + ROW_GAP_MM;
    b.solids.push({
      meshName: id, shape: dstvShape(p.profileType),
      dims: { h: p.heightMm ?? undefined, b: p.widthMm ?? undefined, tw: p.webThicknessMm ?? undefined, tf: p.flangeThicknessMm ?? undefined, t: p.widthMm ?? undefined, d: p.heightMm ?? undefined },
      start: [0, y, 0], end: [p.lengthMm || 1000, y, 0], up: [0, 0, 1], lengthMm: p.lengthMm ?? undefined,
    });
  }
  return { result: b.result('dstv'), solids: b.solids };
}

/** SDNF: members + plates positioned in real global space. */
export function sdnfToExtract(model: SdnfModel, rootName: string): FabBundle {
  const b = new Builder();
  const rootId = 'sdnf-root';
  b.add({
    externalId: rootId, parentExternalId: null, type: 'group', ifcClass: 'SDNF_STRUCTURE',
    name: model.title.structure || rootName || 'SDNF model', mark: null, quantity: 1,
    profile: null, materialGrade: null, lengthMm: null, weightKg: null, depth: 0,
    properties: { project: model.title.project, firm: model.title.firm, version: model.version, sourceFormat: 'sdnf' },
  });
  for (const m of model.members) {
    const id = b.key(`sdnf:m:${m.id}`);
    b.add({
      externalId: id, parentExternalId: rootId, type: 'part', ifcClass: `SDNF_${(m.type || 'MEMBER').toUpperCase()}`,
      name: m.mark || `${m.type || 'Member'} ${m.id}`, mark: m.mark, quantity: 1,
      profile: m.profile, materialGrade: m.grade, lengthMm: m.lengthMm, weightKg: null, depth: 1,
      properties: { memberType: m.type, rotation: m.rotation, start: m.start, end: m.end, revision: m.revision, sourceFormat: 'sdnf' },
    });
    const nominal = nominalSectionMm(m.profile);
    b.solids.push({
      meshName: id, shape: shapeFromDesignation(m.profile),
      dims: { h: nominal, b: nominal * 0.66, d: nominal },
      start: m.start, end: m.end, up: m.orientation ?? [0, 0, 1], lengthMm: m.lengthMm,
    });
  }
  for (const pl of model.plates) {
    const id = b.key(`sdnf:p:${pl.id}`);
    b.add({
      externalId: id, parentExternalId: rootId, type: 'part', ifcClass: 'SDNF_PLATE',
      name: pl.mark || `Plate ${pl.id}`, mark: pl.mark, quantity: 1,
      profile: pl.thicknessMm ? `PL${pl.thicknessMm}` : 'PL', materialGrade: pl.grade,
      lengthMm: pl.lengthMm, weightKg: null, depth: 1,
      properties: { thicknessMm: pl.thicknessMm, widthMm: pl.widthMm, vertices: pl.vertices, sourceFormat: 'sdnf' },
    });
    if (pl.vertices.length >= 3) {
      b.solids.push({ meshName: id, shape: 'B', dims: {}, polygon: { vertices: pl.vertices, thickness: pl.thicknessMm || 10 } });
    }
  }
  return { result: b.result('sdnf'), solids: b.solids };
}

/** KISS: ship-mark (assembly) -> piece-mark (part) BOM hierarchy. */
export function kissToExtract(model: KissModel, rootName: string): FabBundle {
  const b = new Builder();
  const rootId = 'kiss-root';
  b.add({
    externalId: rootId, parentExternalId: null, type: 'group', ifcClass: 'KISS_BOM',
    name: model.jobName || rootName || 'KISS bill of materials', mark: null, quantity: 1,
    profile: null, materialGrade: null, lengthMm: null, weightKg: null, depth: 0,
    properties: { job: model.job, version: model.version, metric: model.metric, sourceFormat: 'kiss' },
  });

  // One assembly node per distinct assembly mark (M line data when present).
  const asmByMark = new Map(model.assemblies.map((a) => [a.mark ?? '', a]));
  const asmKey = new Map<string, string>();
  const distinctMarks: string[] = [];
  for (const p of model.parts) {
    const am = p.assemblyMark ?? '';
    if (am && !asmKey.has(am)) distinctMarks.push(am);
    if (am && !asmKey.has(am)) asmKey.set(am, '');
  }
  for (const am of distinctMarks) {
    const meta = asmByMark.get(am);
    const id = b.key(`kiss:a:${am}`);
    asmKey.set(am, id);
    b.add({
      externalId: id, parentExternalId: rootId, type: 'assembly', ifcClass: 'KISS_ASSEMBLY',
      name: meta?.name || am, mark: am, quantity: meta?.quantity ?? 1,
      profile: null, materialGrade: null, lengthMm: null, weightKg: null, depth: 1,
      properties: { assemblyType: null, sourceFormat: 'kiss' },
    });
  }

  let rowY = 0;
  for (let i = 0; i < model.parts.length; i++) {
    const p = model.parts[i];
    const parent = (p.assemblyMark && asmKey.get(p.assemblyMark)) || rootId;
    const id = b.key(`kiss:p:${p.assemblyMark || 'X'}:${p.mark || i + 1}`);
    b.add({
      externalId: id, parentExternalId: parent, type: 'part', ifcClass: `KISS_${p.type || 'PART'}`,
      name: p.mark || p.profile || `Part ${i + 1}`, mark: p.mark, quantity: p.quantity,
      profile: p.profile, materialGrade: p.grade, lengthMm: p.lengthMm, weightKg: null,
      depth: parent === rootId ? 1 : 2,
      properties: { type: p.type, drawingNo: p.drawingNo, finish: p.finish, notes: p.notes, sourceFormat: 'kiss' },
    });
    const nominal = nominalSectionMm(p.profile);
    const y = rowY + nominal / 2;
    rowY += nominal + ROW_GAP_MM;
    b.solids.push({
      meshName: id, shape: kissShape(p.type), dims: { h: nominal, b: nominal * 0.66, d: nominal },
      start: [0, y, 0], end: [p.lengthMm || 1000, y, 0], up: [0, 0, 1], lengthMm: p.lengthMm ?? undefined,
    });
  }
  return { result: b.result('kiss'), solids: b.solids };
}
