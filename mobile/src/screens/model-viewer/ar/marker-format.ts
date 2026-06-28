// marker-format.ts — pure presentation logic for detected printed markers, shared by
// the in-view HUD (MarkerOverlay) and mirrored by the native 3D highlight colours
// (PcsLidarArView). Keeping the state→colour/label mapping here (not duplicated in
// Swift/JSX) means "what an amber vs green marker means" has ONE definition, and it's
// jest-testable. No native imports — safe anywhere.

/** The visual state of a printed marker, in increasing authority. */
export type MarkerVisualState = 'stale' | 'tracked' | 'bound' | 'active';

/** The fields the HUD/native need to classify + show a marker. */
export interface MarkerView {
  name: string;
  /** metres from the camera. */
  distanceM: number;
  /** ARKit is tracking the physical marker this frame. */
  tracked: boolean;
  /** the model has an offset stored against this marker. */
  bound: boolean;
  /** this marker is the one currently driving the fused pose. */
  active: boolean;
}

/**
 * Classify a marker:
 *   • not tracked        → 'stale'   (last-known pose; not contributing)
 *   • tracked + driving  → 'active'  (the pose anchor right now)
 *   • tracked + bound    → 'bound'   (ready to drive / contributing to the fusion)
 *   • tracked only       → 'tracked' (detected, not yet bound to the model)
 */
export function markerVisualState(m: Pick<MarkerView, 'tracked' | 'bound' | 'active'>): MarkerVisualState {
  if (!m.tracked) return 'stale';
  if (m.active) return 'active';
  if (m.bound) return 'bound';
  return 'tracked';
}

// Palette matches LockPanel's lock-state dots so the whole stability UI reads as one
// system; the native highlight quads use the same hex.
const STATE_COLOR: Record<MarkerVisualState, string> = {
  active: '#10b981', // green — driving the pose
  bound: '#0ea5e9', // blue — bound / contributing
  tracked: '#f59e0b', // amber — detected, not bound
  stale: '#64748b', // slate — lost / last-known
};

const STATE_LABEL: Record<MarkerVisualState, string> = {
  active: 'driving',
  bound: 'bound',
  tracked: 'detected',
  stale: 'lost',
};

export function markerStateColor(s: MarkerVisualState): string {
  return STATE_COLOR[s];
}
export function markerStateLabel(s: MarkerVisualState): string {
  return STATE_LABEL[s];
}

/** Short distance string for a chip: "45 cm" under a metre, else "1.2 m". */
export function formatDistance(m: number): string {
  if (!isFinite(m) || m < 0) return '—';
  return m < 1 ? `${Math.round(m * 100)} cm` : `${m.toFixed(1)} m`;
}

export interface MarkerSummary {
  total: number;
  tracked: number;
  bound: number;
  /** bound AND tracked — the ones that can actually hold the model right now. */
  contributing: number;
  activeName: string | null;
}

/** Roll a marker set up for the HUD header line. */
export function summarizeMarkers(markers: MarkerView[]): MarkerSummary {
  let tracked = 0;
  let bound = 0;
  let contributing = 0;
  let activeName: string | null = null;
  for (const m of markers) {
    if (m.tracked) tracked++;
    if (m.bound) bound++;
    if (m.bound && m.tracked) contributing++;
    if (m.active) activeName = m.name;
  }
  return { total: markers.length, tracked, bound, contributing, activeName };
}

/** Sort markers for display: active first, then nearest tracked, lost last. */
export function sortMarkersForDisplay(markers: MarkerView[]): MarkerView[] {
  const rank = (m: MarkerView) => (m.active ? 0 : m.tracked ? 1 : 2);
  return [...markers].sort((a, b) => {
    const r = rank(a) - rank(b);
    return r !== 0 ? r : a.distanceM - b.distanceM;
  });
}
