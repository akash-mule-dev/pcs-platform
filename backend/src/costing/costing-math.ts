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
  /** Rate FROZEN on the entry at clock-out (worker/stage); wins when > 0. */
  stampedRate?: number | null;
  workerRate?: number | null;
  stageRate?: number | null;
  /** Seconds of the entry that were idle (machine waiting) — paid, costed as a memo overlay. */
  idleSeconds?: number | null;
  isRework?: boolean | null;
  isSetup?: boolean | null;
}

/**
 * The rate for one entry: the stamped (frozen-at-clock-out) rate wins so a
 * later rate change never rewrites history; otherwise fall through the live
 * worker → stage → org-default chain (legacy/un-stamped rows).
 */
export function resolveEntryRate(e: Pick<LaborEntry, 'stampedRate' | 'workerRate' | 'stageRate'>, defaultRate: number): number {
  if (e.stampedRate != null && Number(e.stampedRate) > 0) return Number(e.stampedRate);
  return resolveRate(e.workerRate, e.stageRate, defaultRate);
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
    cost += (s / 3600) * resolveEntryRate(e, defaultRate);
  }
  return { seconds, hours: round2(seconds / 3600), cost: round2(cost) };
}

export interface LaborBucket { seconds: number; cost: number; }
export interface LaborSplit {
  /** Value-add run time (not setup, not rework). */
  productive: LaborBucket;
  /** Machine/fixture set-up — a fixed batch cost. */
  setup: LaborBucket;
  /** Rework — cost of quality (also surfaced in the COQ rollup). */
  rework: LaborBucket;
  /** Idle (machine-waiting) — paid, reported as an overlay memo, NOT a separate slice. */
  idle: LaborBucket;
}

/**
 * Partition paid labor into setup / rework / productive (mutually exclusive by
 * entry classification) and report idle as an overlay memo. An entry flagged
 * BOTH setup and rework counts as rework (cost of quality dominates).
 */
export function splitLabor(entries: LaborEntry[], defaultRate: number): LaborSplit {
  const z = (): LaborBucket => ({ seconds: 0, cost: 0 });
  const productive = z(), setup = z(), rework = z(), idle = z();
  for (const e of entries) {
    const s = paidSeconds(e);
    const rate = resolveEntryRate(e, defaultRate);
    const cost = (s / 3600) * rate;
    const bucket = e.isRework ? rework : e.isSetup ? setup : productive;
    bucket.seconds += s;
    bucket.cost += cost;
    const idleS = Math.max(0, Math.min(s, Number(e.idleSeconds) || 0));
    idle.seconds += idleS;
    idle.cost += (idleS / 3600) * rate;
  }
  const fix = (b: LaborBucket): LaborBucket => ({ seconds: b.seconds, cost: round2(b.cost) });
  return { productive: fix(productive), setup: fix(setup), rework: fix(rework), idle: fix(idle) };
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

export interface MachineEstimateStage {
  machineTimeSeconds: number | null;
  qtyTotal: number | null;
  skipped?: boolean;
  machineRate?: number | null;
}

/**
 * Machine ESTIMATE from stage rows: planned machine seconds per unit × planned
 * units, costed at the stage's standard machine rate. A stage with no machine
 * rate or no machine time contributes nothing. Skipped stages are excluded.
 */
export function machineEstimate(stages: MachineEstimateStage[]): LaborCost {
  let seconds = 0;
  let cost = 0;
  for (const s of stages) {
    if (s.skipped) continue;
    const rate = Math.max(0, Number(s.machineRate) || 0);
    if (rate <= 0) continue;
    const sec = Math.max(0, Number(s.machineTimeSeconds) || 0) * Math.max(0, Number(s.qtyTotal) || 0);
    seconds += sec;
    cost += (sec / 3600) * rate;
  }
  return { seconds, hours: round2(seconds / 3600), cost: round2(cost) };
}

/**
 * Distribute `amount` (currency) across slots in proportion to `basis`, rounded
 * to cents with the largest-remainder method so the parts sum EXACTLY to amount
 * (no penny lost/gained). Used to spread order-level bulk material onto the
 * work orders that consumed it. Returns all-zero when the basis sums to ≤ 0
 * (the caller picks a fallback basis) or amount is 0.
 */
export function allocateProportionally(amount: number, basis: number[]): number[] {
  const n = basis.length;
  const amt = round2(amount || 0);
  if (n === 0 || amt <= 0) return new Array(n).fill(0);
  const clean = basis.map((b) => Math.max(0, Number(b) || 0));
  const total = clean.reduce((s, b) => s + b, 0);
  if (total <= 0) return new Array(n).fill(0);

  const cents = Math.round(amt * 100);
  const raw = clean.map((b) => (b / total) * cents);
  const floored = raw.map((r) => Math.floor(r));
  let remainder = cents - floored.reduce((s, v) => s + v, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const outCents = [...floored];
  for (let k = 0; k < order.length && remainder > 0; k++) { outCents[order[k].i] += 1; remainder--; }
  return outCents.map((c) => round2(c / 100));
}

/** Variance of actual against estimate (absolute + percent; null % when no estimate). */
export function variance(actual: number, estimate: number): { amount: number; percent: number | null } {
  const amount = round2((actual || 0) - (estimate || 0));
  if (!estimate || estimate <= 0) return { amount, percent: null };
  return { amount, percent: round2((amount / estimate) * 100) };
}

/**
 * Compose the final cost summary block (used at WO / order / project levels):
 * total = material + labor + machine + overhead.
 *
 * Overhead is a % on labor. Pass an explicit `overheadAmount` to use a
 * PER-STAGE-weighted overhead (Σ each stage's labor × that stage's % → org
 * default) instead of one flat `overheadPercent` on the aggregate labor; when
 * omitted it falls back to the flat `labor × overheadPercent`.
 */
export function composeTotals(
  material: number, labor: number, overheadPercent: number, machine = 0, overheadAmount?: number,
): { materialCost: number; laborCost: number; machineCost: number; overheadCost: number; totalCost: number } {
  const oh = overheadAmount != null ? round2(Math.max(0, overheadAmount)) : overheadCost(labor, overheadPercent);
  return {
    materialCost: round2(material || 0),
    laborCost: round2(labor || 0),
    machineCost: round2(machine || 0),
    overheadCost: oh,
    totalCost: round2((material || 0) + (labor || 0) + (machine || 0) + oh),
  };
}
