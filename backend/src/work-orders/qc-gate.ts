/**
 * Pure helpers for the production quality gate. No NestJS/TypeORM imports, so
 * this is unit-testable in isolation (`node --experimental-strip-types`).
 *
 * Two complementary gates (see `stageQcGateError`):
 *  - FINAL QC stage — the terminal release gate (`stages.is_final_qc`): cannot
 *    complete while the assembly has ANY open NCR (raised at any stage) or
 *    unsigned failed inspection. Completing it releases the piece; shipping is
 *    also blocked while any NCR is open.
 *  - HOLD point — a per-stage in-process gate (`inspectionType='hold'`): cannot
 *    complete while THAT stage has an open NCR or unsigned failure of its own.
 *
 * Stage QC is opt-in: a plain stage (or a witness/review point) never blocks; a
 * hold point blocks on its own stage; the final-QC stage consolidates them all.
 */

/**
 * Legacy name heuristic for a quality gate (e.g. "Quality Check", "QC",
 * "Final Inspection"). Used ONLY as the fallback for `isFinalQcStage` when the
 * explicit `is_final_qc` flag is unset (null) — see that function.
 */
export function isQualityStageName(name: string | null | undefined): boolean {
  if (!name) return false;
  return /quality|inspect|\bqc\b|\bqa\b/i.test(name);
}

/**
 * Is this the terminal FINAL QC / release gate? Prefers the explicit
 * `is_final_qc` flag; falls back to the name heuristic only when the flag is
 * unset (null), so legacy quality stages keep gating exactly as before while a
 * renamed/explicit gate ("Final Sign-off", `is_final_qc = true`) is recognised
 * and a stage explicitly marked `is_final_qc = false` is never a gate.
 */
export function isFinalQcStage(stage: { name?: string | null; isFinalQc?: boolean | null }): boolean {
  if (stage.isFinalQc === true) return true;
  if (stage.isFinalQc === false) return false;
  return isQualityStageName(stage.name);
}

/** Human message for a blocked quality gate. */
export function qcGateMessage(itemLabel: string, openNcrCount: number): string {
  const plural = openNcrCount === 1 ? '' : 's';
  return `Quality gate: ${itemLabel} has ${openNcrCount} open NCR report${plural}. Resolve the NCR report${plural} before completing the quality stage.`;
}

// ── Inspection-presence gate ─────────────────────────────────────────────────
// Beyond NCRs, a quality stage is also held by the inspections themselves:
//  - ALWAYS: a failed inspection that hasn't been signed off (pending or
//    rejected) blocks completion — you can't pass a QC stage with an
//    unresolved failure on the books.
//  - OPT-IN (stage.requiresInspection): the stage additionally requires at
//    least one acceptable inspection to exist (pass/warning, or a failure
//    formally approved as a concession).

/** Minimal shape of an inspection row the gate needs. */
export interface InspectionSnapshot {
  status: string | null | undefined; // pass | fail | warning
  signoffStatus?: string | null;     // pending | approved | rejected
}

export type InspectionType = 'hold' | 'witness' | 'review' | null | undefined;

export const INSPECTION_TYPE_LABELS: Record<string, string> = {
  hold: 'Hold point',
  witness: 'Witness point',
  review: 'Review point',
};

/**
 * Is this stage a HOLD point — work must not pass without an acceptable
 * inspection? `inspectionType='hold'` is the ITP expression; the legacy
 * `requiresInspection` boolean is honoured when no inspectionType is set.
 * Witness/review points are advisory and never gate on inspection presence.
 */
export function isHoldPoint(stage: { inspectionType?: InspectionType; requiresInspection?: boolean | null }): boolean {
  if (stage.inspectionType) return stage.inspectionType === 'hold';
  return !!stage.requiresInspection;
}

/** Failed inspections still awaiting (or denied) a sign-off decision. */
export function countUnresolvedFailures(entries: InspectionSnapshot[]): number {
  return entries.filter((e) => e.status === 'fail' && e.signoffStatus !== 'approved').length;
}

/** Any inspection that vouches for the part: pass/warning, or an approved (concession) failure. */
export function hasAcceptableInspection(entries: InspectionSnapshot[]): boolean {
  return entries.some(
    (e) => e.status === 'pass' || e.status === 'warning' || (e.status === 'fail' && e.signoffStatus === 'approved'),
  );
}

/**
 * Evaluate the inspection gate for a quality stage. Returns a human-readable
 * block reason, or null when the stage may complete.
 */
export function inspectionGateError(
  itemLabel: string,
  entries: InspectionSnapshot[],
  requiresInspection: boolean,
): string | null {
  const unresolved = countUnresolvedFailures(entries);
  if (unresolved > 0) {
    const plural = unresolved === 1 ? '' : 's';
    return `Quality gate: ${itemLabel} has ${unresolved} failed inspection${plural} awaiting sign-off. Approve (concession) or resolve before completing the quality stage.`;
  }
  if (requiresInspection && !hasAcceptableInspection(entries)) {
    return `Quality gate: ${itemLabel} requires a recorded inspection before this stage can be completed.`;
  }
  return null;
}

// ── Unified stage gate (final-QC rollup vs per-stage hold) ───────────────────

/** Message for a FINAL QC stage blocked by open NCRs anywhere on the assembly. */
export function finalQcNcrMessage(itemLabel: string, openNcrCount: number): string {
  const plural = openNcrCount === 1 ? '' : 's';
  return `Final QC: ${itemLabel} has ${openNcrCount} open NCR report${plural} across its stages. Close (or disposition) the NCR report${plural} before releasing this piece.`;
}

/** Message for a per-stage HOLD point blocked by an open NCR at that stage. */
export function holdPointNcrMessage(itemLabel: string, openNcrCount: number, stageName: string | null | undefined): string {
  const plural = openNcrCount === 1 ? '' : 's';
  const at = stageName ? ` at the "${stageName}" stage` : '';
  return `Quality hold: ${itemLabel} has ${openNcrCount} open NCR report${plural}${at}. Resolve the NCR report${plural} before completing this stage.`;
}

export interface StageGateInput {
  itemLabel: string;
  stage: {
    name?: string | null;
    isFinalQc?: boolean | null;
    inspectionType?: InspectionType;
    requiresInspection?: boolean | null;
  };
  /** Final-QC rollup scope — every open NCR / inspection on the whole assembly. */
  assemblyOpenNcrs: number;
  assemblyInspections: InspectionSnapshot[];
  /** Hold-point scope — open NCRs / inspections recorded at THIS stage only. */
  stageOpenNcrs: number;
  stageInspections: InspectionSnapshot[];
}

/**
 * The single source of truth for whether a stage may be COMPLETED, and why not.
 * Returns a human-readable block reason, or null when the stage may complete.
 *
 *  - Final QC stage → consolidates the WHOLE assembly: blocked by any open NCR
 *    anywhere, any unsigned failure, and (if a hold point) the inspection-
 *    presence rule — evaluated over the assembly-wide snapshots.
 *  - Hold point (non-final) → scoped to ITS OWN stage: blocked by an open NCR
 *    at this stage, an unsigned failure at this stage, or no acceptable
 *    inspection at this stage.
 *  - Anything else (plain / witness / review) → never blocks (advisory).
 */
export function stageQcGateError(input: StageGateInput): string | null {
  const { stage, itemLabel } = input;
  if (isFinalQcStage(stage)) {
    if (input.assemblyOpenNcrs > 0) return finalQcNcrMessage(itemLabel, input.assemblyOpenNcrs);
    return inspectionGateError(itemLabel, input.assemblyInspections, isHoldPoint(stage));
  }
  if (isHoldPoint(stage)) {
    if (input.stageOpenNcrs > 0) return holdPointNcrMessage(itemLabel, input.stageOpenNcrs, stage.name);
    return inspectionGateError(itemLabel, input.stageInspections, true);
  }
  return null;
}
