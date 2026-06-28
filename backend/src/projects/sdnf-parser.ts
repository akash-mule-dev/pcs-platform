/**
 * SDNF (Steel Detailing Neutral Format) parser - pure module (no Nest/TypeORM).
 *
 * SDNF was defined by Intergraph for model exchange between structural/plant
 * design (PDS, AVEVA PDMS/E3D) and steel detailing (Tekla, SDS2). Unlike DSTV
 * (one part per file, CNC machining) an SDNF file carries the WHOLE structural
 * model: linear members + plates positioned in global Cartesian space, so it is
 * the natural source for an assembly tree WITH real geometry.
 *
 * The file is ASCII, organized into "packets"; fields are whitespace-delimited
 * and character strings are double-quoted. Comment lines begin with '#'.
 *   Packet 00 - title (firm, client, structure, project, date, ...)
 *   Packet 10 - linear members
 *   Packet 20 - plate elements
 *   Packet 22 - holes (not consumed here)
 *
 * Linear-member records (Intergraph SDNF 3.0):
 *   Rec1: memberNo cardinalPoint status class "type" "mark" revision
 *   Rec2: "size" "grade" rotation mirrorX mirrorY
 *   Rec3: orientation(3) start(3) end(3) cutbacks(2)   <- end coordinates here
 *   Rec4-6: offsets / releases (skipped)
 * Plate records:
 *   Rec1: plateNo connectPoint status class "type"
 *   Rec2: "mark" "grade" thickness numVertices
 *   then numVertices lines of "X Y Z"
 *
 * The parser keys members off a robust Rec1 signature (first token an integer
 * AND at least two quoted strings), so it tolerates the 6- vs 10-record
 * dialects: it grabs Rec1, Rec2 and the first all-numeric coordinate line, and
 * resyncs on the next member. All coordinates are converted to millimetres.
 */

export interface SdnfTitle {
  firm: string | null;
  client: string | null;
  structure: string | null;
  project: string | null;
}

export interface SdnfMember {
  id: string;
  type: string | null; // "Beam" | "Column" | "Brace" | ...
  mark: string | null;
  revision: string | null;
  /** Section size designation, e.g. "W12X50", "HEA200". */
  profile: string | null;
  grade: string | null;
  rotation: number;
  /** Work-point start/end in millimetres (global Cartesian). */
  start: [number, number, number];
  end: [number, number, number];
  /** Orientation/strong-axis vector (used to roll the section in 3D). */
  orientation: [number, number, number] | null;
  /** Member length (mm) = |end - start|. */
  lengthMm: number;
}

export interface SdnfPlate {
  id: string;
  type: string | null;
  mark: string | null;
  grade: string | null;
  thicknessMm: number | null;
  /** Plate outline vertices in millimetres. */
  vertices: [number, number, number][];
  /** Bounding-box length / width (mm) of the outline. */
  lengthMm: number | null;
  widthMm: number | null;
}

export interface SdnfModel {
  version: string | null;
  title: SdnfTitle;
  /** Linear-units string declared in Packet 10 (e.g. "feet"). */
  units: string | null;
  members: SdnfMember[];
  plates: SdnfPlate[];
}

interface Tok { s: string; quoted: boolean }

function tokenize(line: string): Tok[] {
  const out: Tok[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m[1] !== undefined) out.push({ s: m[1], quoted: true });
    else out.push({ s: m[2], quoted: false });
  }
  return out;
}

const isInt = (s: string): boolean => /^[-+]?\d+$/.test(s);
const numsOf = (toks: Tok[]): number[] =>
  toks.filter((t) => !t.quoted).map((t) => parseFloat(t.s)).filter((n) => Number.isFinite(n));
const quotedOf = (toks: Tok[]): string[] => toks.filter((t) => t.quoted).map((t) => t.s);

/** Length-unit string -> millimetres-per-unit. */
export function sdnfUnitToMm(unit: string | null | undefined): number {
  const u = String(unit ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (!u) return 1;
  if (u.startsWith('feet') || u.startsWith('foot') || u === 'ft') return 304.8;
  if (u.startsWith('inch') || u === 'in') return 25.4;
  if (u.startsWith('milli') || u === 'mm') return 1;
  if (u.startsWith('centi') || u === 'cm') return 10;
  if (u.startsWith('meter') || u.startsWith('metre') || u === 'm') return 1000;
  return 1; // default: assume already millimetres
}

const dist = (a: number[], b: number[]): number =>
  Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);

/** True when the text looks like an SDNF file. */
export function isSdnf(text: string): boolean {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (/^Packet\s+\d+/i.test(line) || /SDNF/i.test(line)) return true;
    // stop early: SDNF declares packets near the top
  }
  return false;
}

export function parseSdnf(text: string): SdnfModel | null {
  if (!isSdnf(text)) return null;
  const lines = text.split(/\r?\n/);
  const model: SdnfModel = {
    version: null,
    title: { firm: null, client: null, structure: null, project: null },
    units: null,
    members: [],
    plates: [],
  };

  // Index the packet header lines.
  type PacketSpan = { num: number; start: number; end: number };
  const spans: PacketSpan[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*Packet\s+(\d+)/i.exec(lines[i]);
    if (m) {
      if (spans.length) spans[spans.length - 1].end = i;
      spans.push({ num: Number(m[1]), start: i, end: lines.length });
    }
  }
  if (!spans.length) return null;

  const contentLines = (span: PacketSpan): string[] => {
    const out: string[] = [];
    for (let i = span.start + 1; i < span.end; i++) {
      const t = lines[i].trim();
      if (!t || t.startsWith('#')) continue;
      out.push(lines[i]);
    }
    return out;
  };
  const versionMatch = /SDNF\s+Version\s+([\d.]+)/i.exec(text);
  if (versionMatch) model.version = versionMatch[1];

  for (const span of spans) {
    if (span.num === 0) {
      const q: string[] = [];
      for (const l of contentLines(span)) { const s = quotedOf(tokenize(l)); if (s.length) q.push(s[0]); }
      model.title = { firm: q[0] ?? null, client: q[1] ?? null, structure: q[2] ?? null, project: q[3] ?? null };
    } else if (span.num === 10) {
      parseMembers(contentLines(span), model);
    } else if (span.num === 20) {
      parsePlates(contentLines(span), model);
    }
  }
  return model;
}

function parseMembers(content: string[], model: SdnfModel): void {
  if (!content.length) return;
  // First content line: linear units + member count.
  const head = tokenize(content[0]);
  model.units = quotedOf(head)[0] ?? (head.find((t) => !isInt(t.s) && !t.quoted)?.s ?? null);
  const scale = sdnfUnitToMm(model.units);

  let cur: SdnfMember | null = null;
  let phase: 'await-size' | 'await-coords' | 'done' = 'done';
  const flush = () => { if (cur) { model.members.push(cur); cur = null; } };

  for (let i = 1; i < content.length; i++) {
    const toks = tokenize(content[i]);
    if (!toks.length) continue;
    const quoted = quotedOf(toks);
    const startsInt = !toks[0].quoted && isInt(toks[0].s);

    if (startsInt && quoted.length >= 2) {
      // Rec1: member start.
      flush();
      const ints = toks.filter((t) => !t.quoted);
      cur = {
        id: ints[0]?.s ?? String(model.members.length + 1),
        type: quoted[0] || null,
        mark: quoted[1] || null,
        revision: ints.length ? ints[ints.length - 1].s : null,
        profile: null, grade: null, rotation: 0,
        start: [0, 0, 0], end: [0, 0, 0], orientation: null, lengthMm: 0,
      };
      phase = 'await-size';
    } else if (cur && phase === 'await-size' && toks[0].quoted && quoted.length >= 2) {
      // Rec2: size + grade (+ rotation).
      cur.profile = quoted[0] || null;
      cur.grade = quoted[1] || null;
      const nums = numsOf(toks);
      if (nums.length) cur.rotation = nums[0];
      phase = 'await-coords';
    } else if (cur && phase === 'await-coords' && quoted.length === 0) {
      // Rec3: orientation(3) + start(3) + end(3) [+ cutbacks].
      const nums = numsOf(toks);
      if (nums.length >= 9) {
        cur.orientation = [nums[0], nums[1], nums[2]];
        cur.start = [nums[3] * scale, nums[4] * scale, nums[5] * scale];
        cur.end = [nums[6] * scale, nums[7] * scale, nums[8] * scale];
        cur.lengthMm = Math.round(dist(cur.start, cur.end) * 100) / 100;
        phase = 'done';
      } else if (nums.length >= 6) {
        cur.start = [nums[0] * scale, nums[1] * scale, nums[2] * scale];
        cur.end = [nums[3] * scale, nums[4] * scale, nums[5] * scale];
        cur.lengthMm = Math.round(dist(cur.start, cur.end) * 100) / 100;
        phase = 'done';
      }
    }
  }
  flush();
}

function parsePlates(content: string[], model: SdnfModel): void {
  if (!content.length) return;
  // First content line: linear units, thickness units, plate count.
  const head = quotedOf(tokenize(content[0]));
  const linScale = sdnfUnitToMm(head[0] ?? model.units);
  const thkScale = sdnfUnitToMm(head[1] ?? head[0] ?? model.units);

  let i = 1;
  while (i < content.length) {
    const r1 = tokenize(content[i]);
    const q1 = quotedOf(r1);
    const startsInt = r1[0] && !r1[0].quoted && isInt(r1[0].s);
    if (!startsInt || q1.length < 1) { i++; continue; }
    const id = r1.filter((t) => !t.quoted)[0]?.s ?? String(model.plates.length + 1);
    const type = q1[0] || null;
    i++;
    if (i >= content.length) break;
    const r2 = tokenize(content[i]);
    const q2 = quotedOf(r2);
    const n2 = numsOf(r2);
    const mark = q2[0] || null;
    const grade = q2[1] || null;
    const thicknessMm = n2.length ? Math.round(n2[0] * thkScale * 100) / 100 : null;
    const nVerts = n2.length >= 2 ? Math.round(n2[n2.length - 1]) : 0;
    i++;
    const vertices: [number, number, number][] = [];
    for (let v = 0; v < nVerts && i < content.length; v++, i++) {
      const nv = numsOf(tokenize(content[i]));
      if (nv.length >= 3) vertices.push([nv[0] * linScale, nv[1] * linScale, nv[2] * linScale]);
    }
    let lengthMm: number | null = null;
    let widthMm: number | null = null;
    if (vertices.length) {
      const xs = vertices.map((p) => p[0]), ys = vertices.map((p) => p[1]), zs = vertices.map((p) => p[2]);
      const spanOf = (a: number[]) => Math.max(...a) - Math.min(...a);
      const dims = [spanOf(xs), spanOf(ys), spanOf(zs)].sort((a, b) => b - a);
      lengthMm = Math.round(dims[0] * 100) / 100;
      widthMm = Math.round(dims[1] * 100) / 100;
    }
    model.plates.push({ id, type, mark, grade, thicknessMm, vertices, lengthMm, widthMm });
  }
}
