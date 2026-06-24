// Pure helpers for the 3D Viewer tools — no RN/Viro imports, unit-testable.
import { MNode } from '../../../services/projects.service';

export type ColorBy = 'none' | 'profile' | 'grade';

// A categorical palette (distinct, legible on the light viewer background).
export const CATEGORY_PALETTE = [
  '#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#9333ea', '#0891b2',
  '#db2777', '#65a30d', '#ea580c', '#0d9488', '#7c3aed', '#b45309',
];
export const OTHER_COLOR = '#94a3b8'; // null / overflow bucket

export interface LegendEntry {
  label: string;
  hex: string;
  /** How many in-scope members fall in this category (shown in the legend). */
  count: number;
}

export interface ColorByResult {
  /** mesh name (ifc_guid) → hex int, for PartWebViewer.colors. */
  colors: Record<string, number>;
  legend: LegendEntry[];
}

const MAX_CATEGORIES = 11; // 12th palette slot reserved for the "Other" bucket

function hexToInt(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

/**
 * Build a name→color map + legend for colouring isolated meshes by a node
 * attribute. Distinct values get palette colours (most-common first); anything
 * past the cap, plus nodes missing the attribute, fall into "Other".
 *
 * `meshNames` scopes the result to the meshes actually shown (the isolated set);
 * pass null/[] to colour every node that has a mesh handle.
 */
export function buildColorBy(
  nodes: MNode[],
  by: ColorBy,
  meshNames: string[] | null,
): ColorByResult {
  if (by === 'none') return { colors: {}, legend: [] };

  const inScope = meshNames && meshNames.length ? new Set(meshNames) : null;
  const valueOf = (n: MNode) => (by === 'profile' ? n.profile : n.materialGrade) || null;

  // Count members per distinct value across the in-scope nodes (those carrying a
  // mesh); nodes missing the attribute, plus anything past the palette cap, fall
  // into "Other".
  const counts = new Map<string, number>();
  let otherCount = 0;
  for (const n of nodes) {
    const key = n.meshName || n.ifcGuid;
    if (!key) continue;
    if (inScope && !inScope.has(key) && !(n.ifcGuid && inScope.has(n.ifcGuid))) continue;
    const v = valueOf(n);
    if (!v) { otherCount++; continue; }
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]); // [value, count], most common first
  const top = ranked.slice(0, MAX_CATEGORIES);
  ranked.slice(MAX_CATEGORIES).forEach(([, c]) => { otherCount += c; });

  const valueColor = new Map<string, string>();
  top.forEach(([v], i) => valueColor.set(v, CATEGORY_PALETTE[i]));

  const colors: Record<string, number> = {};
  for (const n of nodes) {
    const key = n.meshName || n.ifcGuid;
    if (!key) continue;
    if (inScope && !inScope.has(key) && !(n.ifcGuid && inScope.has(n.ifcGuid))) continue;
    const v = valueOf(n);
    const hex = v && valueColor.has(v) ? valueColor.get(v)! : OTHER_COLOR;
    colors[key] = hexToInt(hex);
    if (n.ifcGuid) colors[n.ifcGuid] = hexToInt(hex);
  }

  const legend: LegendEntry[] = top.map(([v, c]) => ({ label: v, hex: valueColor.get(v)!, count: c }));
  if (otherCount > 0) legend.push({ label: 'Other', hex: OTHER_COLOR, count: otherCount });

  return { colors, legend };
}

/** Reference lengths for mm calibration from part nodes with a known length. */
export function referenceLengthsFrom(nodes: MNode[]): { name: string; lengthMm: number }[] {
  const out: { name: string; lengthMm: number }[] = [];
  for (const n of nodes) {
    const name = n.meshName || n.ifcGuid;
    if (!name || !n.lengthMm || n.lengthMm <= 0) continue;
    out.push({ name, lengthMm: n.lengthMm });
  }
  return out;
}

/** Real millimetres → a short human string, matching the in-viewer labels. */
export function formatMm(mm: number | null | undefined): string {
  if (mm == null || !isFinite(mm)) return '—';
  if (mm >= 1000) return `${(mm / 1000).toFixed(mm >= 10000 ? 1 : 2)} m`;
  return `${Math.round(mm)} mm`;
}
