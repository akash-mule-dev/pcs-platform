/**
 * Pure helpers for the production quality gate. No NestJS/TypeORM imports, so
 * this is unit-testable in isolation (`node --experimental-strip-types`).
 *
 * The gate: a stage that *is* a quality stage cannot be COMPLETED while the
 * assembly it belongs to still has open NCRs, and an assembly cannot be added
 * to a shipment while it has open NCRs.
 */

/** Stage names that act as a quality gate (e.g. "Quality Check", "QC", "Final Inspection"). */
export function isQualityStageName(name: string | null | undefined): boolean {
  if (!name) return false;
  return /quality|inspect|\bqc\b|\bqa\b/i.test(name);
}

/** NCR statuses that still block the gate (anything not closed/cancelled). */
export function isOpenNcrStatus(status: string | null | undefined): boolean {
  return status !== 'closed' && status !== 'cancelled';
}

/** Human message for a blocked quality gate. */
export function qcGateMessage(itemLabel: string, openNcrCount: number): string {
  const plural = openNcrCount === 1 ? '' : 's';
  return `Quality gate: ${itemLabel} has ${openNcrCount} open NCR${plural}. Close or disposition the NCR${plural} before completing the quality stage.`;
}
