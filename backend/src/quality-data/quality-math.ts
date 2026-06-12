/**
 * Pure helpers for quality inspection math & status rules. No NestJS/TypeORM
 * imports, so this is unit-testable in isolation
 * (`node --experimental-strip-types src/quality-data/quality-math.test.ts`).
 *
 * Single source of truth for:
 *  - the inspection status / severity vocabularies,
 *  - tolerance evaluation (is a measurement in spec?),
 *  - the auto-fail rule (out-of-tolerance measurements can never be "pass"),
 *  - the sign-off rule (which entries need a sign-off decision).
 */

export const QUALITY_STATUSES = ['pass', 'fail', 'warning'] as const;
export type QualityStatus = (typeof QUALITY_STATUSES)[number];

export const QUALITY_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type QualitySeverity = (typeof QUALITY_SEVERITIES)[number];

export const SIGNOFF_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type SignoffStatus = (typeof SIGNOFF_STATUSES)[number];

export interface ToleranceResult {
  /** true when the value satisfies every bound that is present. */
  inTolerance: boolean;
  /** Which bound was breached, when any. */
  breached: 'min' | 'max' | null;
  /** Signed distance outside the breached bound (0 when in tolerance). */
  deviation: number;
}

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Evaluate a measurement against optional min/max tolerances. Bounds are
 * inclusive; absent bounds are not enforced. Non-numeric input is treated as
 * "no measurement" (in tolerance) so callers don't have to pre-validate.
 */
export function evaluateTolerance(
  value: number | string | null | undefined,
  toleranceMin: number | string | null | undefined,
  toleranceMax: number | string | null | undefined,
): ToleranceResult {
  const v = num(value);
  if (v === null) return { inTolerance: true, breached: null, deviation: 0 };
  const min = num(toleranceMin);
  const max = num(toleranceMax);
  if (min !== null && v < min) return { inTolerance: false, breached: 'min', deviation: v - min };
  if (max !== null && v > max) return { inTolerance: false, breached: 'max', deviation: v - max };
  return { inTolerance: true, breached: null, deviation: 0 };
}

/**
 * The auto-fail rule: whatever status the inspector picked, an out-of-tolerance
 * measurement makes the entry a FAIL. In-tolerance measurements keep the
 * inspector's judgement (they may still flag a visual defect).
 */
export function applyAutoFail(
  status: string,
  value: number | string | null | undefined,
  toleranceMin: number | string | null | undefined,
  toleranceMax: number | string | null | undefined,
): QualityStatus | string {
  return evaluateTolerance(value, toleranceMin, toleranceMax).inTolerance ? status : 'fail';
}

/** Failed entries are the ones that require a sign-off decision. */
export function requiresSignoff(status: string | null | undefined): boolean {
  return status === 'fail';
}

export function isQualityStatus(s: unknown): s is QualityStatus {
  return typeof s === 'string' && (QUALITY_STATUSES as readonly string[]).includes(s);
}

export function isQualitySeverity(s: unknown): s is QualitySeverity {
  return typeof s === 'string' && (QUALITY_SEVERITIES as readonly string[]).includes(s);
}
