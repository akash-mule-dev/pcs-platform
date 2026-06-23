/**
 * Pure NCR (non-conformance) lifecycle rules for an `ncr`-type QualityReport.
 * No Nest/TypeORM imports — unit-testable in isolation (see ncr-workflow.test.ts).
 *
 * Lifecycle (ISO 9001:2015 §8.7 — control of nonconforming outputs):
 *   open → under_review → dispositioned → closed   (+ cancelled, + reopen)
 *
 * The GATE that blocks shipping + quality-stage completion is keyed on the
 * report's `resolvedAt` timestamp (set on CLOSE or CANCEL), NOT on this status —
 * so the existing gate queries are untouched. `isGateBlocking()` documents the
 * equivalence: a report is gate-blocking exactly while it is neither closed nor
 * cancelled (i.e. resolvedAt is null).
 */

export type NcrStatus = 'open' | 'under_review' | 'dispositioned' | 'closed' | 'cancelled';
export type NcrDisposition = 'rework' | 'repair' | 'use_as_is' | 'scrap' | 'return_to_supplier';

export const NCR_STATUS_LABELS: Record<NcrStatus, string> = {
  open: 'Open',
  under_review: 'Under review',
  dispositioned: 'Dispositioned',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

/**
 * Material Review dispositions. `needsConcession` flags the ones that accept a
 * deviation from spec (require engineering/customer authorization per §8.7.1c/d);
 * `needsReinspection` flags corrections that must be re-verified before close
 * (§8.7.1 "conformity shall be verified when nonconforming outputs are corrected").
 */
export const NCR_DISPOSITIONS: {
  value: NcrDisposition; label: string; needsConcession: boolean; needsReinspection: boolean;
}[] = [
  { value: 'rework', label: 'Rework (restore to full conformance)', needsConcession: false, needsReinspection: true },
  { value: 'repair', label: 'Repair (acceptable, not to full spec)', needsConcession: true, needsReinspection: true },
  { value: 'use_as_is', label: 'Use as-is (concession)', needsConcession: true, needsReinspection: false },
  { value: 'scrap', label: 'Scrap', needsConcession: false, needsReinspection: false },
  { value: 'return_to_supplier', label: 'Return to supplier', needsConcession: false, needsReinspection: false },
];

export const NCR_DISPOSITION_VALUES: NcrDisposition[] = NCR_DISPOSITIONS.map((d) => d.value);

export function isNcrDisposition(v: unknown): v is NcrDisposition {
  return typeof v === 'string' && NCR_DISPOSITION_VALUES.includes(v as NcrDisposition);
}

export function dispositionLabel(d: string | null | undefined): string {
  return NCR_DISPOSITIONS.find((x) => x.value === d)?.label ?? (d ?? '—');
}

/** Rework + repair are corrections → must pass a re-inspection before close. */
export function requiresReinspection(d: string | null | undefined): boolean {
  return !!NCR_DISPOSITIONS.find((x) => x.value === d)?.needsReinspection;
}

/** Repair + use-as-is accept a deviation → need an authorized concession before close. */
export function requiresConcession(d: string | null | undefined): boolean {
  return !!NCR_DISPOSITIONS.find((x) => x.value === d)?.needsConcession;
}

/** A report is gate-blocking exactly while it is neither closed nor cancelled. */
export function isGateBlocking(status: NcrStatus): boolean {
  return status !== 'closed' && status !== 'cancelled';
}

/** Allowed status transitions (the state machine). */
const ALLOWED: Record<NcrStatus, NcrStatus[]> = {
  open: ['under_review', 'dispositioned', 'cancelled'],
  under_review: ['open', 'dispositioned', 'cancelled'],
  dispositioned: ['under_review', 'closed', 'cancelled'],
  closed: ['under_review'],   // reopen
  cancelled: ['open'],        // un-cancel (raised in error, actually a real NC)
};

export function canTransition(from: NcrStatus, to: NcrStatus): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}

/** Disposition can be recorded/changed only while the NCR is not closed/cancelled. */
export function canRecordDisposition(status: NcrStatus): boolean {
  return isGateBlocking(status);
}

/**
 * Gate for CLOSING an NCR. A disposition must be decided first, and any
 * correction (rework/repair) must have a passing re-inspection recorded AFTER
 * the disposition (ISO §8.7.1 verify-correction). Returns a human reason on fail.
 */
export function assertCloseable(input: {
  status: NcrStatus;
  disposition: string | null;
  hasPassingReinspection: boolean;
  hasConcession?: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (input.status === 'closed') return { ok: false, reason: 'This NCR is already closed.' };
  if (input.status === 'cancelled') return { ok: false, reason: 'A cancelled NCR cannot be closed — reopen it first.' };
  if (!input.disposition) {
    return { ok: false, reason: 'Record a disposition (rework / repair / use-as-is / scrap / return) before closing this NCR.' };
  }
  if (requiresConcession(input.disposition) && !input.hasConcession) {
    return {
      ok: false,
      reason: `A ${dispositionLabel(input.disposition).toLowerCase()} accepts a deviation from spec — record an authorized concession (a reason) before closing this NCR.`,
    };
  }
  if (requiresReinspection(input.disposition) && !input.hasPassingReinspection) {
    return {
      ok: false,
      reason: `A ${dispositionLabel(input.disposition).toLowerCase()} must pass a re-inspection recorded after the disposition before this NCR can be closed.`,
    };
  }
  return { ok: true };
}
