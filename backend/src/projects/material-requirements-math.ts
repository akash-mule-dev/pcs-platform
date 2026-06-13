/**
 * Pure, dependency-free BILL-OF-MATERIALS math for the fabrication module
 * (no NestJS/TypeORM imports — unit-testable in isolation, like quantity-math).
 *
 * The assembly tree's PART nodes carry the design facts (profile, grade,
 * length, weight, quantity). Aggregating them by (profile, grade) yields the
 * raw-material requirement for ONE unit of the design; a production order of
 * quantity Q simply scales every line by Q. Inventory coverage then compares
 * the scaled requirement against matched material masters' on-hand stock.
 */

export interface RequirementPart {
  profile: string | null;
  materialGrade: string | null;
  lengthMm: number | null;
  weightKg: number | null;
  quantity: number; // how many times this part occurs in one design unit
}

export interface RequirementLine {
  /** Normalized matching key: `<PROFILE>|<GRADE>` (uppercased, trimmed). */
  key: string;
  profile: string | null;
  materialGrade: string | null;
  pieceCount: number;
  totalLengthMm: number;
  totalWeightKg: number;
}

/** Normalize a profile/grade fragment for matching: trim + collapse spaces + uppercase. */
export function normalizeKeyPart(v: string | null | undefined): string {
  return (v ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

export function requirementKey(profile: string | null | undefined, grade: string | null | undefined): string {
  return `${normalizeKeyPart(profile)}|${normalizeKeyPart(grade)}`;
}

const round3 = (v: number) => Math.round((v + Number.EPSILON) * 1000) / 1000;
const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/**
 * Aggregate part nodes into requirement lines, grouped by (profile, grade).
 * Parts with neither profile nor grade group into one "unspecified" line so
 * imported tonnage is never silently dropped. Lines sort by weight (desc) —
 * the heavy stuff a fab shop buys first comes first.
 */
export function aggregateRequirements(parts: RequirementPart[]): RequirementLine[] {
  const byKey = new Map<string, RequirementLine>();
  for (const p of parts) {
    const qty = Math.max(0, Math.floor(p.quantity || 0)) || 0;
    if (qty <= 0) continue;
    const key = requirementKey(p.profile, p.materialGrade);
    let line = byKey.get(key);
    if (!line) {
      line = {
        key,
        profile: p.profile?.trim() || null,
        materialGrade: p.materialGrade?.trim() || null,
        pieceCount: 0,
        totalLengthMm: 0,
        totalWeightKg: 0,
      };
      byKey.set(key, line);
    }
    line.pieceCount += qty;
    line.totalLengthMm = round2(line.totalLengthMm + Math.max(0, p.lengthMm || 0) * qty);
    line.totalWeightKg = round3(line.totalWeightKg + Math.max(0, p.weightKg || 0) * qty);
  }
  return [...byKey.values()].sort(
    (a, b) => b.totalWeightKg - a.totalWeightKg || b.pieceCount - a.pieceCount || a.key.localeCompare(b.key),
  );
}

/** Scale per-unit requirement lines by an order quantity. */
export function scaleRequirements(lines: RequirementLine[], factor: number): RequirementLine[] {
  const f = Math.max(0, Math.floor(factor || 0));
  return lines.map((l) => ({
    ...l,
    pieceCount: l.pieceCount * f,
    totalLengthMm: round2(l.totalLengthMm * f),
    totalWeightKg: round3(l.totalWeightKg * f),
  }));
}

/**
 * The quantity a requirement line demands, expressed in a material's unit of
 * measure. Steel stock is overwhelmingly kept in kg; meters and pieces are
 * supported; anything unrecognized falls back to weight (flagged by caller).
 */
export function requiredQtyInUom(line: Pick<RequirementLine, 'pieceCount' | 'totalLengthMm' | 'totalWeightKg'>, uom: string | null | undefined): number {
  const u = (uom ?? '').trim().toLowerCase();
  if (u === 'm' || u === 'meter' || u === 'metre' || u === 'mtr') return round3(line.totalLengthMm / 1000);
  if (u === 'mm') return round2(line.totalLengthMm);
  if (u === 'ea' || u === 'pcs' || u === 'pc' || u === 'piece' || u === 'pieces' || u === 'each') return line.pieceCount;
  if (u === 't' || u === 'ton' || u === 'tonne') return round3(line.totalWeightKg / 1000);
  return round3(line.totalWeightKg); // kg + default
}

export type CoverageStatus = 'unmapped' | 'covered' | 'short' | 'issued';

/**
 * Coverage of one line: how it stands against stock + what was already issued.
 *  - `unmapped`  — no material master matches (cannot issue / cost it yet)
 *  - `issued`    — fully issued (remaining ≤ 0)
 *  - `covered`   — on-hand stock covers the remaining requirement
 *  - `short`     — not enough stock for what's still needed
 */
export function coverage(requiredQty: number, issuedQty: number, onHand: number | null, mapped: boolean): {
  status: CoverageStatus;
  remainingQty: number;
  shortfallQty: number;
} {
  const required = Math.max(0, requiredQty || 0);
  const issued = Math.max(0, issuedQty || 0);
  const remaining = round3(Math.max(0, required - issued));
  if (!mapped) return { status: 'unmapped', remainingQty: remaining, shortfallQty: remaining };
  if (remaining <= 0) return { status: 'issued', remainingQty: 0, shortfallQty: 0 };
  const available = Math.max(0, onHand ?? 0);
  if (available >= remaining) return { status: 'covered', remainingQty: remaining, shortfallQty: 0 };
  return { status: 'short', remainingQty: remaining, shortfallQty: round3(remaining - available) };
}

function round3Export(v: number): number { return round3(v); }
export { round3Export as roundQty };
