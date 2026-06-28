/**
 * KISS ("Keep It Simple, Steel") parser - pure module (no Nest/TypeORM).
 *
 * KISS is the public-domain BOM interchange of steel fabrication (FabTrol /
 * SteelKiss.org), exported by Tekla EPM (PowerFab/FabSuite), SDS2, Advance
 * Steel and others. It is a comma-delimited ASCII file (.kss) whose first line
 * identifies it as "KISS". Each subsequent line is a record keyed by its first
 * field; we consume the ones that build a bill of materials tree:
 *
 *   KISS , version , generating-software         (identification line)
 *   H , job# , jobName , customer , date , time , metric(T/F) , fileType
 *   D , drawingNo , rev , assemblyMark , partMark , qty , type , size ,
 *       grade , length(mm) , finish , notes ...                 (detail part)
 *   M , assemblyMark , assemblyQty , assemblyName , type , desc , ...  (v1.1)
 *
 * Length is always in millimetres per the standard (endnote: "Length should be
 * in millimetres and tenths of millimetres"), regardless of the Metric flag
 * (which only governs the size-designation + weight units). Leading detail
 * fields are positionally stable across v1.0/v1.1, so we read [1..9] reliably;
 * trailing v1.1 fields (which sit after the free-text Notes) are not relied on.
 * Records other than D / M / H (A address, L labor, S sequence, C CNC, W
 * drawing, * comment) are ignored - they do not shape the tree.
 */

/** KISS material type codes (FabTrol) -> human family. */
export const KISS_TYPE_NAMES: Record<string, string> = {
  W: 'Wide flange', M: 'M beam', S: 'S beam', H: 'H-pile', HP: 'H-pile',
  C: 'Channel', MC: 'Misc channel', L: 'Angle', WT: 'WT tee', ST: 'ST tee',
  HSS: 'Tube (HSS)', PI: 'Pipe', PL: 'Plate', FB: 'Flat bar', RB: 'Round bar',
  SQ: 'Square bar', CP: 'Checkered plate', AB: 'Anchor bolt', HS: 'High-strength bolt',
  MB: 'Machine bolt', WS: 'Weld stud', WA: 'Wedge anchor', MI: 'Miscellaneous',
};

export interface KissPart {
  drawingNo: string | null;
  /** Ship / assembly mark this part belongs to (D field 3). */
  assemblyMark: string | null;
  /** Piece mark (D field 4) - maps to AssemblyNode.mark. */
  mark: string | null;
  /** Total quantity required (D field 5). */
  quantity: number;
  /** Material type code (D field 6): W|PL|L|HSS|C|WT|... */
  type: string | null;
  /** Section designation (D field 7), e.g. "W 12x40" - maps to profile. */
  profile: string | null;
  /** ASTM grade (D field 8). */
  grade: string | null;
  /** Length in millimetres (D field 9). */
  lengthMm: number | null;
  finish: string | null;
  notes: string | null;
}

export interface KissAssembly {
  mark: string | null;
  quantity: number;
  name: string | null;
}

export interface KissModel {
  version: string | null;
  job: string | null;
  jobName: string | null;
  /** True when the file declares metric size designations (H field 6 = T). */
  metric: boolean;
  parts: KissPart[];
  assemblies: KissAssembly[];
}

const cell = (fields: string[], i: number): string | null => {
  const v = (fields[i] ?? '').trim();
  return v || null;
};
const intCell = (fields: string[], i: number): number => {
  const n = parseInt((fields[i] ?? '').trim(), 10);
  return Number.isFinite(n) ? n : 1;
};
const numCell = (fields: string[], i: number): number | null => {
  const n = parseFloat((fields[i] ?? '').trim());
  return Number.isFinite(n) ? n : null;
};

/** True when the text is a KISS file (first non-empty line starts with KISS). */
export function isKiss(text: string): boolean {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    return /^KISS\b/i.test(line) || /^KISS,/i.test(line);
  }
  return false;
}

export function parseKiss(text: string): KissModel | null {
  if (!isKiss(text)) return null;
  const model: KissModel = { version: null, job: null, jobName: null, metric: false, parts: [], assemblies: [] };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const fields = line.split(',');
    const tag = (fields[0] ?? '').trim().toUpperCase();

    if (tag === 'KISS') {
      model.version = cell(fields, 1);
    } else if (tag === 'H') {
      model.job = cell(fields, 1);
      model.jobName = cell(fields, 2);
      model.metric = /^T/i.test((fields[6] ?? '').trim());
    } else if (tag === 'D') {
      const profile = cell(fields, 7);
      const type = cell(fields, 6);
      model.parts.push({
        drawingNo: cell(fields, 1),
        assemblyMark: cell(fields, 3),
        mark: cell(fields, 4),
        quantity: Math.max(1, intCell(fields, 5)),
        type,
        profile: profile ?? type,
        grade: cell(fields, 8),
        lengthMm: numCell(fields, 9),
        finish: cell(fields, 10),
        notes: cell(fields, 11),
      });
    } else if (tag === 'M') {
      model.assemblies.push({
        mark: cell(fields, 1),
        quantity: Math.max(1, intCell(fields, 2)),
        name: cell(fields, 3),
      });
    }
    // A / L / S / C / W / * lines are intentionally ignored.
  }
  return model;
}
