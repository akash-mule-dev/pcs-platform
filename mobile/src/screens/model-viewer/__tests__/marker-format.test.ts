import {
  markerVisualState,
  markerStateColor,
  markerStateLabel,
  formatDistance,
  summarizeMarkers,
  sortMarkersForDisplay,
  MarkerView,
} from '../ar/marker-format';

const mk = (over: Partial<MarkerView>): MarkerView => ({
  name: 'pcs-marker-0',
  distanceM: 1,
  tracked: true,
  bound: false,
  active: false,
  ...over,
});

describe('marker-format — state classification', () => {
  it('classifies by authority', () => {
    expect(markerVisualState({ tracked: false, bound: true, active: false })).toBe('stale');
    expect(markerVisualState({ tracked: true, bound: false, active: false })).toBe('tracked');
    expect(markerVisualState({ tracked: true, bound: true, active: false })).toBe('bound');
    expect(markerVisualState({ tracked: true, bound: true, active: true })).toBe('active');
  });
  it('active requires tracking (a lost marker can never be "active")', () => {
    expect(markerVisualState({ tracked: false, bound: true, active: true })).toBe('stale');
  });
  it('every state has a distinct colour + a label', () => {
    const states = ['active', 'bound', 'tracked', 'stale'] as const;
    const colors = states.map(markerStateColor);
    expect(new Set(colors).size).toBe(4);
    states.forEach((s) => expect(markerStateLabel(s)).toBeTruthy());
  });
});

describe('marker-format — formatting', () => {
  it('formats distance sub-metre in cm, else metres', () => {
    expect(formatDistance(0.45)).toBe('45 cm');
    expect(formatDistance(0.999)).toBe('100 cm');
    expect(formatDistance(1.2)).toBe('1.2 m');
    expect(formatDistance(2.57)).toBe('2.6 m');
    expect(formatDistance(-1)).toBe('—');
  });
});

describe('marker-format — summary + sort', () => {
  it('summarises a marker set', () => {
    const s = summarizeMarkers([
      mk({ name: 'a', tracked: true, bound: true, active: true }),
      mk({ name: 'b', tracked: true, bound: true }),
      mk({ name: 'c', tracked: true, bound: false }),
      mk({ name: 'd', tracked: false, bound: true }),
    ]);
    expect(s).toEqual({ total: 4, tracked: 3, bound: 3, contributing: 2, activeName: 'a' });
  });
  it('sorts active first, then nearest tracked, lost last', () => {
    const order = sortMarkersForDisplay([
      mk({ name: 'far', distanceM: 3, tracked: true }),
      mk({ name: 'lost', distanceM: 0.1, tracked: false, bound: true }),
      mk({ name: 'active', distanceM: 2, active: true }),
      mk({ name: 'near', distanceM: 0.5, tracked: true }),
    ]).map((m) => m.name);
    expect(order).toEqual(['active', 'near', 'far', 'lost']);
  });
});
