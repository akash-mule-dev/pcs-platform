/**
 * Pure helpers for the production quality gate. No NestJS/TypeORM imports, so
 * this is unit-testable in isolation (`node --experimental-strip-types`).
 *
 * The gate: a stage that *is* a quality stage cannot be COMPLETED while the
 * assembly it belongs to still has open NCR reports (unresolved `ncr`-type QC
 * reports), and an assembly cannot be added to a shipment while it has any.
 */

/** Stage names that act as a quality gate (e.g. "Quality Check", "QC", "Final Inspection"). */
export function isQualityStageName(name: string | null | undefined): boolean {
  if (!name) return false;
  return /quality|inspect|\bqc\b|\bqa\b/i.test(name);
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
