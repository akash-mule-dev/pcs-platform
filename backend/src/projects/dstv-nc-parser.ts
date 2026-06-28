/**
 * DSTV NC / NC1 parser - pure module (no Nest/TypeORM, unit-testable).
 *
 * DSTV (Deutsche Stahlbau-Verband) "NC1" is the universal, machine-neutral CNC
 * interface of steel fabrication: every detailer (Tekla, SDS2, Advance Steel,
 * Bocad, ...) exports it and every machine brand (Voortman, Peddinghaus, Ficep,
 * Kaltenbach, ...) consumes it. It is plain ASCII; in almost every case ONE file
 * describes ONE part, so a folder/ZIP of `.nc1` files is a parts list.
 *
 * A file is a sequence of blocks. The first block is the start header `ST`,
 * which carries exactly the fabrication facts PCS promotes onto AssemblyNode
 * (piece mark, steel grade, quantity, profile + profile-type, length, section
 * dimensions, weight-per-metre). The remaining blocks describe machining
 * (holes `BO`, contours `AK`/`IK`, marks `SI`/`KO`/`PU`, bends `KA`). We read
 * the header positionally (the DSTV field order is fixed) and tally the
 * machining blocks (hole count, contour presence) for the properties bag.
 *
 * Header field order after the `ST` line (DSTV "Standard Description for Steel
 * Structure Pieces for the Numerical Controls"):
 *   1  order identification           (text)
 *   2  drawing identification         (text)
 *   3  phase identification           (text)
 *   4  piece identification / MARK    (text)
 *   5  steel quality / grade          (text)
 *   6  quantity                       (int)
 *   7  profile / section designation  (text, e.g. "HEA200", "W12X26")
 *   8  profile type code              (I|U|L|M|RO|RU|B|C|T|SO)
 *   9  length (mm)                    (float)
 *   10 profile height (mm)
 *   11 flange width (mm)
 *   12 flange thickness (mm)
 *   13 web thickness (mm)
 *   14 radius (mm)
 *   15 weight per metre (kg/m)
 *   ...  painting surface, cut angles, info lines (ignored)
 *
 * Decimal separators may be '.' or ',', so numbers are normalized. The parser
 * is deliberately tolerant: blank/short headers yield nulls rather than throw.
 */

/** DSTV start-header block markers - the header ends at the first of these. */
const BLOCK_MARKERS = new Set(['EN', 'BO', 'SI', 'AK', 'IK', 'PU', 'KO', 'KA', 'SC', 'TO', 'UE', 'BR', 'PL']);

/** DSTV profile-type code -> human family (matches Tekla's DSTV description). */
export const DSTV_PROFILE_TYPES: Record<string, string> = {
  I: 'I-profile',
  U: 'U / C channel',
  L: 'Angle',
  M: 'Rectangular hollow section',
  RO: 'Round tube',
  RU: 'Round bar',
  B: 'Plate',
  C: 'C-profile',
  T: 'T-profile',
  SO: 'Special profile',
};

export interface DstvPart {
  order: string | null;
  drawing: string | null;
  phase: string | null;
  /** Piece mark (DSTV field 4) - maps to AssemblyNode.mark. */
  mark: string | null;
  /** Steel grade / quality (field 5) - maps to materialGrade. */
  grade: string | null;
  /** Number of identical pieces (field 6). */
  quantity: number;
  /** Section designation (field 7), e.g. "HEA200", "W12X26", "L100*100*10". */
  profile: string | null;
  /** Profile-type code (field 8): I|U|L|M|RO|RU|B|C|T|SO. */
  profileType: string | null;
  /** Length of the part (field 9, mm) - maps to lengthMm. */
  lengthMm: number | null;
  /** Section height (field 10, mm). */
  heightMm: number | null;
  /** Flange / section width (field 11, mm). */
  widthMm: number | null;
  /** Flange thickness (field 12, mm). */
  flangeThicknessMm: number | null;
  /** Web thickness (field 13, mm). */
  webThicknessMm: number | null;
  /** Root radius (field 14, mm). */
  radiusMm: number | null;
  /** Weight per metre (field 15, kg/m). */
  weightPerMetre: number | null;
  /** Total piece weight (kg) = weight/m x length, when both are known. */
  weightKg: number | null;
  /** Number of holes (sum of BO block rows). */
  holeCount: number;
  /** Whether the part carries an outer contour (AK) - i.e. real cut geometry. */
  hasContour: boolean;
}

const firstToken = (line: string): string => line.trim().split(/\s+/)[0] ?? '';

/**
 * Parse a DSTV number; tolerates ',' decimal separators, '.'/',' thousands
 * grouping and trailing text. The LAST separator is taken as the decimal point
 * ("1.234,56" -> 1234.56 ; "1,234.56" -> 1234.56 ; "1234,56" -> 1234.56).
 */
export function dstvNum(raw: string | undefined): number | null {
  if (raw == null) return null;
  let t = firstToken(String(raw));
  if (!t) return null;
  const lastComma = t.lastIndexOf(',');
  const lastDot = t.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    const decSep = lastComma > lastDot ? ',' : '.';
    const thouSep = decSep === ',' ? '.' : ',';
    t = t.split(thouSep).join('').replace(decSep, '.');
  } else if (lastComma >= 0) {
    t = t.replace(',', '.');
  }
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

const cleanText = (line: string | undefined): string | null => {
  if (line == null) return null;
  const v = line.trim();
  if (!v || v === '-') return null;
  return v;
};

/** True when the text looks like the start of a DSTV NC file. */
export function isDstvNc(text: string): boolean {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    return line === 'ST' || line.startsWith('ST');
  }
  return false;
}

/**
 * Parse one DSTV NC/NC1 file. Returns null if the text is not a DSTV file.
 * `fallbackMark` (e.g. the filename stem) is used when the header omits a mark.
 */
export function parseDstvNc(text: string, fallbackMark?: string): DstvPart | null {
  const rawLines = text.split(/\r?\n/);
  let i = 0;
  while (i < rawLines.length && rawLines[i].trim() === '') i++;
  if (i >= rawLines.length) return null;
  const startLine = rawLines[i].trim();
  if (startLine !== 'ST' && !startLine.startsWith('ST')) return null;
  i++; // move past ST

  // Collect header field lines until the first block marker (or EOF). Keep them
  // physically (a blank line is a legitimately-empty text field).
  const header: string[] = [];
  let blockStart = rawLines.length;
  for (let j = i; j < rawLines.length; j++) {
    const tok = rawLines[j].trim();
    if (BLOCK_MARKERS.has(tok)) { blockStart = j; break; }
    header.push(rawLines[j]);
  }

  const f = (idx: number): string | undefined => header[idx];
  const lengthMm = dstvNum(f(8));
  const weightPerMetre = dstvNum(f(14));
  const profileType = (cleanText(f(7)) || '').toUpperCase() || null;

  // Machining blocks: count holes (BO) + detect an outer contour (AK).
  let holeCount = 0;
  let hasContour = false;
  for (let j = blockStart; j < rawLines.length; j++) {
    const tok = rawLines[j].trim();
    if (tok === 'EN') break;
    if (tok === 'AK') hasContour = true;
    if (tok === 'BO') {
      for (let k = j + 1; k < rawLines.length; k++) {
        const t2 = rawLines[k].trim();
        if (!t2) continue;
        if (BLOCK_MARKERS.has(t2)) break;
        holeCount++;
      }
    }
  }

  const weightKg =
    weightPerMetre != null && lengthMm != null
      ? Math.round(weightPerMetre * (lengthMm / 1000) * 1000) / 1000
      : null;

  return {
    order: cleanText(f(0)),
    drawing: cleanText(f(1)),
    phase: cleanText(f(2)),
    mark: cleanText(f(3)) ?? (fallbackMark ? fallbackMark.toUpperCase() : null),
    grade: cleanText(f(4)),
    quantity: Math.max(1, Math.round(dstvNum(f(5)) ?? 1)),
    profile: cleanText(f(6)),
    profileType,
    lengthMm: lengthMm != null ? Math.round(lengthMm * 100) / 100 : null,
    heightMm: dstvNum(f(9)),
    widthMm: dstvNum(f(10)),
    flangeThicknessMm: dstvNum(f(11)),
    webThicknessMm: dstvNum(f(12)),
    radiusMm: dstvNum(f(13)),
    weightPerMetre,
    weightKg,
    holeCount,
    hasContour,
  };
}
