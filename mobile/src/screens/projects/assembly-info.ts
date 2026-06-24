/**
 * Pure helpers for the Assembly Info panel.
 *
 * An imported fabrication node carries far more than the handful of promoted
 * columns (profile / grade / length / weight) the old info sheet showed — those
 * are sparsely populated, while the real detail lives in the `properties` jsonb
 * bag (AISC / Tekla / SDS2 Psets & Qtos extracted at import). This module turns
 * that raw bag into clean, grouped, de-duplicated key/value sections and derives
 * the fabrication headline (falling back to the bag when a column is blank).
 *
 * No React / Nest / network imports — unit-testable in isolation.
 */

export interface InfoRow {
  label: string;
  value: string;
}
export interface PropGroup {
  title: string;
  rows: InfoRow[];
}

const ACRONYMS = new Set([
  'SDS2', 'AISC', 'IFC', 'ID', 'NC', 'GUID', 'MTR', 'QA', 'QC', 'UC', 'UB', 'PFC',
  'HSS', 'CHS', 'RHS', 'SHS', 'NS', 'FS', 'CG', 'X', 'Y', 'Z', 'EM11',
]);

/** Humanise a raw key: split camelCase / snake_case / dots into Title Case words. */
export function prettifyLabel(key: string): string {
  if (!key) return '';
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase boundary
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // ACRONYMWord boundary
    .replace(/[_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((w) => {
      const up = w.toUpperCase();
      if (ACRONYMS.has(up)) return up;
      if (/^\d/.test(w)) return w; // leave numbers / dimensions as-is
      return up.charAt(0) + w.slice(1).toLowerCase();
    })
    .join(' ');
}

/** Humanise a Pset/Qto prefix into a readable section title. */
export function prettifyPset(prefix: string): string {
  if (!prefix) return 'General';
  if (/^default$/i.test(prefix)) return 'General';
  const stripped = prefix
    .replace(/^AISC_[A-Za-z0-9]+_Pset_/i, '')
    .replace(/^Pset_/i, '')
    .replace(/^Qto_/i, '');
  return prettifyLabel(stripped || prefix);
}

/** Format a raw property value to a display string, or null if it carries no info. */
export function formatPropValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length ? t : null;
  }
  if (Array.isArray(v)) {
    const joined = v.map(formatPropValue).filter((x): x is string => x !== null).join(', ');
    return joined || null;
  }
  if (typeof v === 'object') {
    try {
      const j = JSON.stringify(v);
      return j === '{}' || j === '[]' ? null : j;
    } catch {
      return null;
    }
  }
  return String(v);
}

/** First non-empty value among the candidate keys (checked verbatim, in order). */
export function pickProp(
  properties: Record<string, unknown> | null | undefined,
  candidates: string[],
): string | null {
  if (!properties) return null;
  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(properties, key)) {
      const v = formatPropValue(properties[key]);
      if (v !== null) return v;
    }
  }
  return null;
}

// Sections that fabricators care about most, surfaced first; everything else is
// alphabetical with the catch-all "General" bucket last.
const GROUP_PRIORITY = [
  'Piece Identification',
  'Assembly Identification',
  'Material',
  'Drawing Number',
  'Drawing',
  'Scheduling Information',
  'SDS2 Unified',
  'Beam Quantities',
  'Plate Quantities',
];

/**
 * Group the properties bag into de-duplicated, prettified sections.
 *
 * Keys come in two forms — bare (`MaterialGrade`) and dotted `Pset.Prop`
 * (`AISC_EM11_Pset_Material.MaterialGrade`) — and the bare form is almost always
 * a duplicate of a dotted one. We keep the dotted (grouped) form and drop the
 * bare duplicate, filter out empty/placeholder values, and drop empty groups.
 */
export function groupNodeProperties(
  properties: Record<string, unknown> | null | undefined,
): PropGroup[] {
  if (!properties || typeof properties !== 'object') return [];
  const entries = Object.entries(properties);

  // Leaf names that appear in a dotted key — bare keys with the same leaf are dupes.
  const dottedLeaves = new Set<string>();
  for (const [k] of entries) {
    const i = k.indexOf('.');
    if (i > 0) dottedLeaves.add(k.slice(i + 1));
  }

  const groups = new Map<string, Map<string, string>>(); // title -> (label -> value)
  const order: string[] = [];
  const add = (title: string, leaf: string, raw: unknown) => {
    const value = formatPropValue(raw);
    if (value === null) return;
    const label = prettifyLabel(leaf);
    if (!label) return;
    if (!groups.has(title)) {
      groups.set(title, new Map());
      order.push(title);
    }
    const rows = groups.get(title)!;
    if (!rows.has(label)) rows.set(label, value); // first non-empty wins
  };

  for (const [k, v] of entries) {
    const i = k.indexOf('.');
    if (i > 0) {
      add(prettifyPset(k.slice(0, i)), k.slice(i + 1), v);
    } else if (!dottedLeaves.has(k)) {
      add('General', k, v); // bare key with no grouped twin
    }
  }

  const result = order
    .map((title) => ({
      title,
      rows: Array.from(groups.get(title)!, ([label, value]) => ({ label, value })),
    }))
    .filter((g) => g.rows.length > 0);

  const rank = (title: string): number => {
    const p = GROUP_PRIORITY.indexOf(title);
    if (p !== -1) return p;
    return title === 'General' ? 999 : 500;
  };
  result.sort((a, b) => {
    const r = rank(a.title) - rank(b.title);
    return r !== 0 ? r : a.title.localeCompare(b.title);
  });
  return result;
}

/** mm → "1234 mm  ·  1.23 m" (drops the metre hint under 1 m). */
export function formatLength(mm: number | null | undefined): string | null {
  if (mm === null || mm === undefined || !Number.isFinite(mm)) return null;
  const rounded = Math.round(mm * 10) / 10;
  const mmTxt = `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} mm`;
  return mm >= 1000 ? `${mmTxt}  ·  ${(mm / 1000).toFixed(2)} m` : mmTxt;
}

/** kg → "12.3 kg" (adds a tonnes hint at/above 1 t). */
export function formatWeight(kg: number | null | undefined): string | null {
  if (kg === null || kg === undefined || !Number.isFinite(kg)) return null;
  const kgTxt = `${Math.round(kg * 10) / 10} kg`;
  return kg >= 1000 ? `${kgTxt}  ·  ${(kg / 1000).toFixed(2)} t` : kgTxt;
}

export interface FabNode {
  profile?: string | null;
  materialGrade?: string | null;
  lengthMm?: number | null;
  weightKg?: number | null;
  quantity?: number;
}

/**
 * The fabrication headline — promoted columns first, falling back to the
 * properties bag so a node with blank columns still shows its real spec.
 */
export function buildFabricationRows(
  node: FabNode | null | undefined,
  properties: Record<string, unknown> | null | undefined,
): InfoRow[] {
  const rows: InfoRow[] = [];
  const profile =
    (node?.profile && node.profile.trim()) ||
    pickProp(properties, ['PROFILE', 'Profile', 'Default.PROFILE']);
  if (profile) rows.push({ label: 'Profile / section', value: profile });

  const grade =
    (node?.materialGrade && node.materialGrade.trim()) ||
    pickProp(properties, [
      'AISC_EM11_Pset_Material.MaterialGrade',
      'MaterialGrade',
      'Grade',
    ]);
  if (grade) rows.push({ label: 'Material grade', value: grade });

  const matType = pickProp(properties, [
    'AISC_EM11_Pset_Material.MaterialType',
    'MaterialType',
  ]);
  if (matType && matType.toLowerCase() !== String(grade ?? '').toLowerCase()) {
    rows.push({ label: 'Material type', value: matType });
  }

  const len = formatLength(node?.lengthMm);
  if (len) rows.push({ label: 'Length', value: len });

  const wt = formatWeight(node?.weightKg);
  if (wt) rows.push({ label: 'Weight', value: wt });

  if (node?.quantity != null && node.quantity > 1) {
    rows.push({ label: 'Quantity (in design)', value: `×${node.quantity}` });
  }
  return rows;
}

const IFC_CLASS_LABELS: Record<string, string> = {
  IFCBEAM: 'Beam',
  IFCCOLUMN: 'Column',
  IFCMEMBER: 'Member',
  IFCPLATE: 'Plate',
  IFCELEMENTASSEMBLY: 'Assembly',
  IFCBUILDINGELEMENTPROXY: 'Element',
  IFCFOOTING: 'Footing',
  IFCRAILING: 'Railing',
  IFCSLAB: 'Slab',
  IFCWALL: 'Wall',
  IFCSTAIR: 'Stair',
  IFCFASTENER: 'Fastener',
  IFCMECHANICALFASTENER: 'Bolt',
  IFCDISCRETEACCESSORY: 'Accessory',
  IFCPILE: 'Pile',
};

/** "IFCBEAM" → "Beam"; unknown classes fall back to a humanised name. */
export function ifcClassLabel(ifcClass: string | null | undefined): string | null {
  if (!ifcClass) return null;
  const up = ifcClass.toUpperCase();
  if (IFC_CLASS_LABELS[up]) return IFC_CLASS_LABELS[up];
  return prettifyLabel(ifcClass.replace(/^IFC/i, '')) || ifcClass;
}

const NODE_TYPE_LABELS: Record<string, string> = {
  group: 'Group',
  assembly: 'Assembly',
  subassembly: 'Subassembly',
  part: 'Part',
};
export function nodeTypeLabel(nodeType: string | null | undefined): string {
  if (!nodeType) return 'Item';
  return NODE_TYPE_LABELS[nodeType] ?? prettifyLabel(nodeType);
}
