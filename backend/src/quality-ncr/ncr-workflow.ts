/**
 * Pure NCR / CAPA workflow rules. No NestJS/TypeORM imports, so this is
 * unit-testable in isolation
 * (`node --experimental-strip-types src/quality-ncr/ncr-workflow.test.ts`).
 *
 * The lifecycle (mirrors a conventional QMS flow):
 *
 *   open ──► investigation ──► disposition ──► closed
 *     │            │               │             │
 *     │            │               └─► investigation (more digging needed)
 *     │            └─► cancelled                 └─► investigation (reopen)
 *     └─► disposition | cancelled
 *
 *  - `cancelled` is terminal (raised in error / duplicate).
 *  - Closing REQUIRES a disposition decision (rework/scrap/use-as-is/…).
 *  - Reopening a closed NCR goes back to `investigation` and clears the
 *    close stamp — the disposition that proved wrong is kept for the record.
 *
 * CAPA: open ──► in_progress ──► verified ──► closed, with verified ──►
 * in_progress when verification finds the action incomplete. Closing requires
 * prior verification (verified is the only state that may close).
 */

export type NcrStatusValue = 'open' | 'investigation' | 'disposition' | 'closed' | 'cancelled';
export type CapaStatusValue = 'open' | 'in_progress' | 'verified' | 'closed';

export const NCR_TRANSITIONS: Record<NcrStatusValue, NcrStatusValue[]> = {
  open: ['investigation', 'disposition', 'cancelled'],
  investigation: ['disposition', 'cancelled'],
  disposition: ['closed', 'investigation'],
  closed: ['investigation'],
  cancelled: [],
};

export const CAPA_TRANSITIONS: Record<CapaStatusValue, CapaStatusValue[]> = {
  open: ['in_progress', 'verified'],
  in_progress: ['verified', 'open'],
  verified: ['closed', 'in_progress'],
  closed: [],
};

/** Legal next statuses from a given NCR status (empty for terminal states). */
export function ncrNextStatuses(from: string | null | undefined): NcrStatusValue[] {
  return NCR_TRANSITIONS[from as NcrStatusValue] ?? [];
}

export function canTransitionNcr(from: string | null | undefined, to: string | null | undefined): boolean {
  if (!to || from === to) return false;
  return ncrNextStatuses(from).includes(to as NcrStatusValue);
}

export function capaNextStatuses(from: string | null | undefined): CapaStatusValue[] {
  return CAPA_TRANSITIONS[from as CapaStatusValue] ?? [];
}

export function canTransitionCapa(from: string | null | undefined, to: string | null | undefined): boolean {
  if (!to || from === to) return false;
  return capaNextStatuses(from).includes(to as CapaStatusValue);
}

/**
 * Validation for an NCR status change. Returns null when OK, otherwise a
 * human-readable reason. `disposition` is the value the NCR will have AFTER
 * the update (existing or supplied in the same request).
 */
export function ncrTransitionError(
  from: string,
  to: string,
  disposition: string | null | undefined,
): string | null {
  if (from === to) return null; // no-op, not a transition
  if (!canTransitionNcr(from, to)) {
    const legal = ncrNextStatuses(from);
    return legal.length
      ? `Cannot move NCR from '${from}' to '${to}' — allowed: ${legal.join(', ')}.`
      : `NCR is '${from}' (terminal) and cannot change status.`;
  }
  if (to === 'closed' && !disposition) {
    return 'An NCR cannot be closed without a disposition (rework, scrap, use-as-is, return-to-supplier or regrade).';
  }
  return null;
}

/** Validation for a CAPA status change. Returns null when OK. */
export function capaTransitionError(from: string, to: string): string | null {
  if (from === to) return null;
  if (!canTransitionCapa(from, to)) {
    const legal = capaNextStatuses(from);
    if (to === 'closed' && from !== 'verified') {
      return 'A CAPA must be verified before it can be closed.';
    }
    return legal.length
      ? `Cannot move CAPA from '${from}' to '${to}' — allowed: ${legal.join(', ')}.`
      : `CAPA is '${from}' (terminal) and cannot change status.`;
  }
  return null;
}

/** Statuses that still count as "open" for gates (shipping / quality stage). */
export function isOpenNcr(status: string | null | undefined): boolean {
  return status !== 'closed' && status !== 'cancelled';
}

/** Map NCR severity to a notification priority. */
export function severityToPriority(severity: string | null | undefined): 'low' | 'medium' | 'high' | 'critical' {
  switch (severity) {
    case 'critical': return 'critical';
    case 'high': return 'high';
    case 'low': return 'low';
    default: return 'medium';
  }
}
