/**
 * Pure, dependency-free STATION (work-center) utilization math — no
 * NestJS/TypeORM imports, so it is unit-testable in isolation (mirrors
 * costing-math / quantity-math / progress-math).
 *
 * The raw aggregates come from a single org-scoped GROUP BY over time_entries
 * (see StationsService.utilization); this module turns them into the shape the
 * cockpit/directory render and computes utilization % against the station's
 * declared capacity. It deliberately does NO rounding of inputs and NO I/O.
 *
 * Definitions:
 *   - attended = paid clocked seconds at the station = Σ max(duration − break, 0)
 *     over COMPLETED entries (open sessions have no duration yet, so they don't
 *     count toward historical utilization — they drive the live "busy" flag).
 *   - setup    = attended seconds flagged is_setup (and not rework)
 *   - rework   = attended seconds flagged is_rework
 *   - run      = attended − setup − rework (the productive remainder, clamped ≥ 0)
 *   - idle     = the worker-idle overlay (time_entries.idle_seconds); informational,
 *     NOT subtracted from attended (costing charges full attended time too).
 *   - available = availableHoursPerDay × days-in-window (null when no capacity basis)
 *   - utilization % = attended hours ÷ available hours × 100 (null when no basis).
 *     NOT capped at 100 — multiple operators at one station can exceed it, which
 *     is a real (and useful) signal of an over-subscribed work-center.
 */

export interface StationActivityInput {
  /** Σ paid seconds (duration − break) over completed entries at the station. */
  attendedSeconds: number;
  /** Σ paid seconds flagged setup (and not rework). */
  setupSeconds: number;
  /** Σ paid seconds flagged rework. */
  reworkSeconds: number;
  /** Σ idle_seconds overlay (worker idle within an entry). */
  idleSeconds: number;
  /** Σ paid seconds that incurred a machine rate (> 0). */
  machineSeconds: number;
  /** Rate-weighted machine cost = Σ (paid/3600 × resolvedMachineRate). */
  machineCost: number;
  /** Count of time entries. */
  entries: number;
  /** Distinct operators (users). */
  operators: number;
}

export interface CapacityContext {
  /** Station's hours/day basis (null/0 ⇒ no utilization %). */
  availableHoursPerDay: number | null;
  /** Inclusive calendar days spanned by the window (≥ 1). */
  windowDays: number;
}

export interface StationUtilization {
  attendedSeconds: number;
  attendedHours: number;
  setupSeconds: number;
  runSeconds: number;
  reworkSeconds: number;
  idleSeconds: number;
  setupHours: number;
  runHours: number;
  reworkHours: number;
  idleHours: number;
  machineSeconds: number;
  machineHours: number;
  machineCost: number;
  entries: number;
  operators: number;
  /** availableHoursPerDay × windowDays, or null when no basis is set. */
  availableHours: number | null;
  /** attendedHours ÷ availableHours × 100 (one decimal), or null when no basis. */
  utilizationPct: number | null;
}

export function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

export function round1(v: number): number {
  return Math.round((v + Number.EPSILON) * 10) / 10;
}

export function secondsToHours(seconds: number): number {
  return round2(Math.max(0, seconds) / 3600);
}

/** run = attended − setup − rework, clamped to ≥ 0 (defends against bad/overlapping flags). */
export function runSeconds(attendedSeconds: number, setupSeconds: number, reworkSeconds: number): number {
  return Math.max(0, attendedSeconds - setupSeconds - reworkSeconds);
}

/** available hours for the window, or null when the station has no capacity basis. */
export function availableHours(availableHoursPerDay: number | null | undefined, windowDays: number): number | null {
  const hpd = Number(availableHoursPerDay);
  if (!Number.isFinite(hpd) || hpd <= 0) return null;
  const days = Math.max(1, Math.floor(windowDays));
  return round2(hpd * days);
}

/** utilization %, or null when there is no capacity basis to divide by. */
export function utilizationPct(attendedSeconds: number, ctx: CapacityContext): number | null {
  const avail = availableHours(ctx.availableHoursPerDay, ctx.windowDays);
  if (avail == null || avail <= 0) return null;
  return round1((Math.max(0, attendedSeconds) / 3600 / avail) * 100);
}

/** Inclusive calendar-day count spanned by [from, to] (≥ 1). Pure (caller supplies the dates). */
export function windowDaysInclusive(from: Date, to: Date): number {
  const MS_PER_DAY = 86_400_000;
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.max(1, Math.floor((b - a) / MS_PER_DAY) + 1);
}

/** Compose the full per-station utilization view from raw aggregates + capacity. */
export function composeStationUtilization(input: StationActivityInput, ctx: CapacityContext): StationUtilization {
  const attended = Math.max(0, input.attendedSeconds);
  const setup = Math.max(0, input.setupSeconds);
  const rework = Math.max(0, input.reworkSeconds);
  const run = runSeconds(attended, setup, rework);
  const idle = Math.max(0, input.idleSeconds);
  const machineSec = Math.max(0, input.machineSeconds);
  return {
    attendedSeconds: attended,
    attendedHours: secondsToHours(attended),
    setupSeconds: setup,
    runSeconds: run,
    reworkSeconds: rework,
    idleSeconds: idle,
    setupHours: secondsToHours(setup),
    runHours: secondsToHours(run),
    reworkHours: secondsToHours(rework),
    idleHours: secondsToHours(idle),
    machineSeconds: machineSec,
    machineHours: secondsToHours(machineSec),
    machineCost: round2(Math.max(0, input.machineCost)),
    entries: Math.max(0, Math.round(input.entries)),
    operators: Math.max(0, Math.round(input.operators)),
    availableHours: availableHours(ctx.availableHoursPerDay, ctx.windowDays),
    utilizationPct: utilizationPct(attended, ctx),
  };
}

/** Strip the cost-bearing fields for callers without costing.view (rates off the floor). */
export function withoutCost(u: StationUtilization): StationUtilization {
  return { ...u, machineSeconds: 0, machineHours: 0, machineCost: 0 };
}
