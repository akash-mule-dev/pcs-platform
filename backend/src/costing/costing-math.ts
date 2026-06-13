/**
 * Pure, dependency-free COSTING math (no NestJS/TypeORM imports —
 * unit-testable in isolation, mirroring quantity-math / progress-math).
 *
 * Cost model (fab-shop standard):
 *   total = material + labor + overhead
 *   - material — net stock consumption (issues + scrap − returns) valued at
 *     the unit cost STAMPED on each ledger row (moving average at issue time);
 *   - labor    — clocked time × an hourly rate resolved per entry:
 *                worker's personal rate → stage standard rate → org default;
 *   - overhead — a configurable percentage applied on labor (shop burden).
 *
 * Estimates use the same shapes from planned numbers: BOM quantities × current
 * material prices, and stage target times × stage/default rates — so actual vs
 * estimate is always an apples-to-apples comparison.
 */

export interface CostingSettings {
  /** Org-wide fallback labor rate (currency/hour). */
  defaultLaborRate: number;
  /** Shop overhead applied on labor cost, in percent (e.g. 15 = +15%). */
  overheadPercent: number;
  /** ISO 4217 display currency (costs are stored unit-less). */
  currency: string;
}

export const DEFAULT_COSTING_SETTINGS: CostingSettings = {
  defaultLaborRate: 30,
  overheadPercent: 0,
  currency: 'USD',
};

export function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** Sanitize raw (jsonb / legacy) settings into a usable CostingSettings. */
export function normalizeSettings(raw: any, legacyLaborRate?: unknown): CostingSettings {
  const num = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const defaultLaborRate =
    num(raw?.defaultLaborRate) ?? num(legacyLaborRate) ?? DEFAULT_COSTING_SETTINGS.defaultLaborRate;
  const overheadPercent = Math.min(num(raw?.overheadPercent) ?? DEFAULT_COSTING_SETTINGS.overheadPercent, 500);
  const currency =
    typeof raw?.currency === 'string' && /^[A-Za-z]{3}$/.test(raw.currency.trim())
      ? raw.currency.trim().toUpperCase()
      : DEFAULT_COSTING_SETTINGS.currency;
  return { defaultLaborRate, overheadPercent, currency };
}

/**
 * Per-entry labor rate: the worker's personal rate wins, then the stage's
 * standard rate, then the org default. Zero/negative/absent = "not set".
 */
export function resolveRate(
  workerRate: number | null | undefined,
  stageRate: number | null | undefined,
  defaultRate: number,
): number {
  if (workerRate != null && Number(workerRate) > 0) return Number(workerRate);
  if (stageRate != null && Number(stageRate) > 0) return Number(stageRate);
  return Math.max(0, defaultRate || 0);
}

export interface LaborEntry {
  durationSeconds: number | null;
  breakSeconds?: number | null;
  workerRate?: number | null;
  stageRate?: number | null;
}

/** Paid seconds of one entry: clocked minus breaks, never negative. */
export function paidSeconds(e: Pick<LaborEntry, 'durationSeconds' | 'breakSeconds'>): number {
  return Math.max(0, (Number(e.durationSeconds) || 0) - (Number(e.breakSeconds) || 0));
}

export interface LaborCost {
  seconds: number;
  hours: number;
  cost: number;
}

/** Roll labor entries into hours + cost, resolving the rate per entry. */
export function laborCost(entries: LaborEntry[], defaultRate: number): LaborCost {
  let seconds = 0;
  let cost = 0;
  for (const e of entries) {
    const s = paidSeconds(e);
    seconds += s;
    cost += (s / 3600) * resolveRate(e.workerRate, e.stageRate, defaultRate);
  }
  return { seconds, hours: round2(seconds / 3600), cost: round2(cost) };
}

/** Overhead applied on labor (percent, e.g. 15 → 0.15 × labor). */
export function overheadCost(labor: number, overheadPercent: number): number {
  const pct = Math.max(0, overheadPercent || 0);
  return round2(Math.max(0, labor || 0) * (pct / 100));
}

export interface EstimateStage {
  targetTimeSeconds: number | null;
  qtyTotal: number | null;
  skipped?: boolean;
  stageRate?: number | null;
}

/**
 * Labor ESTIMATE from stage rows: target time per unit × planned units,
 * costed at the stage rate (workers are unknown at planning time) or default.
 * Skipped stages are not work to do.
 */
export function laborEstimate(stages: EstimateStage[], defaultRate: number): LaborCost {
  let seconds = 0;
  let cost = 0;
  for (const s of stages) {
    if (s.skipped) continue;
    const sec = Math.max(0, Number(s.targetTimeSeconds) || 0) * Math.max(0, Number(s.qtyTotal) || 0);
    seconds += sec;
    cost += (sec / 3600) * resolveRate(null, s.stageRate, defaultRate);
  }
  return { seconds, hours: round2(seconds / 3600), cost: round2(cost) };
}

/** Variance of actual against estimate (absolute + percent; null % when no estimate). */
export function variance(actual: number, estimate: number): { amount: number; percent: number | null } {
  const amount = round2((actual || 0) - (estimate || 0));
  if (!estimate || estimate <= 0) return { amount, percent: null };
  return { amount, percent: round2((amount / estimate) * 100) };
}

/** Compose the final cost summary block (used at WO / order / project levels). */
export function composeTotals(material: number, labor: number, overheadPercent: number): {
  materialCost: number; laborCost: number; overheadCost: number; totalCost: number;
} {
  const oh = overheadCost(labor, overheadPercent);
  return {
    materialCost: round2(material || 0),
    laborCost: round2(labor || 0),
    overheadCost: oh,
    totalCost: round2((material || 0) + (labor || 0) + oh),
  };
}
