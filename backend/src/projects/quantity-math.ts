/**
 * Pure, dependency-free quantity + stage math for COUNT-BASED work-order tracking
 * (the scalable, industry-standard model: track "done out of total" per stage,
 * not one row per serialized unit).
 *
 * For a work order of quantity Q, an assembly that appears `nodeQty` times in the
 * project design has `nodeQty * Q` physical units. Each stage of that assembly
 * tracks `qtyDone` out of that total. Stage status, assembly %, and order % are
 * all DERIVED from the counts — so the model degrades to a plain on/off flag when
 * the total is 1, and rolls up cleanly when it isn't.
 *
 * No NestJS/TypeORM imports, so it is unit-testable in isolation.
 */

export type StageStatus = 'not_started' | 'in_progress' | 'completed' | 'skipped';
export type RollupStatus = 'not_started' | 'in_progress' | 'completed';

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Total physical units of one assembly within a work order. */
export function stageUnitsTotal(nodeQty: number, orderQty: number): number {
  const n = Math.max(0, Math.floor(nodeQty || 0));
  const q = Math.max(0, Math.floor(orderQty || 0));
  return n * q;
}

/** Derive a stage's status from its completed count (an explicit skip wins). */
export function stageStatusFromCount(qtyDone: number, qtyTotal: number, skipped = false): StageStatus {
  if (skipped) return 'skipped';
  if (qtyTotal <= 0) return 'not_started';
  const done = clamp(qtyDone, 0, qtyTotal);
  if (done <= 0) return 'not_started';
  if (done >= qtyTotal) return 'completed';
  return 'in_progress';
}

/** A single stage's completion percent (0..100). Skipped stages read as 100%. */
export function stagePercent(qtyDone: number, qtyTotal: number, skipped = false): number {
  if (skipped) return 100;
  if (qtyTotal <= 0) return 0;
  return Math.round((clamp(qtyDone, 0, qtyTotal) / qtyTotal) * 10000) / 100;
}

export interface CountStage { qtyDone: number; qtyTotal: number; skipped?: boolean }

export interface CountRollup {
  status: RollupStatus;
  percentComplete: number; // 0..100, weighted by units across all stages
  unitsDone: number;
  unitsTotal: number;
}

/**
 * Roll a set of stage counts (e.g. every stage of one assembly, or every stage of
 * every assembly in a whole work order) into an overall percent + status.
 * Skipped stages are excluded from the denominator (they're not work to do).
 */
export function rollupCounts(stages: CountStage[]): CountRollup {
  let done = 0;
  let total = 0;
  let anyProgress = false;
  for (const s of stages) {
    if (s.skipped) continue;
    const t = Math.max(0, s.qtyTotal || 0);
    const d = clamp(s.qtyDone || 0, 0, t);
    total += t;
    done += d;
    if (d > 0) anyProgress = true;
  }
  const percentComplete = total > 0 ? Math.round((done / total) * 10000) / 100 : 0;
  const status: RollupStatus =
    total > 0 && done >= total ? 'completed' : anyProgress ? 'in_progress' : 'not_started';
  return { status, percentComplete, unitsDone: done, unitsTotal: total };
}
