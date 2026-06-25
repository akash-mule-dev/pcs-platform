/**
 * Revision impact — pure module (no Nest/TypeORM imports, unit-testable).
 *
 * The severity + aggregation rules behind the change-order report: given how
 * much production has already happened on a revised/removed piece, how much is
 * at risk. The DB graph-walk that gathers work orders + shipped qty per piece
 * lives in ifc-import.service.ts; the CLASSIFICATION lives here so it can be
 * tested in isolation and stays consistent between the read endpoint and the
 * import-time work-order flagging.
 */

export type RevisionSeverity = 'critical' | 'high' | 'medium' | 'none';

/** Severity ordering for sorting (most urgent first). */
export const SEVERITY_ORDER: RevisionSeverity[] = ['critical', 'high', 'medium', 'none'];

/**
 * Classify a single affected piece:
 *  - critical: already shipped (in the customer's hands)
 *  - high:     production units recorded (work done on it)
 *  - medium:   work orders exist but nothing recorded yet (only planned)
 *  - none:     no production work touches this piece
 */
export function revisionSeverity(shippedQty: number, unitsDone: number, workOrderCount: number): RevisionSeverity {
  if (shippedQty > 0) return 'critical';
  if (unitsDone > 0) return 'high';
  if (workOrderCount > 0) return 'medium';
  return 'none';
}

/** Roll a set of classified rows up into the headline counts. */
export function summarizeImpact(rows: { severity: RevisionSeverity }[]): {
  pieces: number;
  critical: number;
  high: number;
  medium: number;
  none: number;
} {
  return {
    pieces: rows.length,
    critical: rows.filter((r) => r.severity === 'critical').length,
    high: rows.filter((r) => r.severity === 'high').length,
    medium: rows.filter((r) => r.severity === 'medium').length,
    none: rows.filter((r) => r.severity === 'none').length,
  };
}

/** Stable comparator: most urgent severity first. */
export function bySeverity(a: { severity: RevisionSeverity }, b: { severity: RevisionSeverity }): number {
  return SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
}
