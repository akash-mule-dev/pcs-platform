import {
  evaluateDrift,
  DriftSample,
  DEFAULT_DRIFT_PARAMS,
  lockStateLabel,
  shouldTriggerRealign,
  DEFAULT_FAILURE_PARAMS,
  isFarFromOrigin,
  DEFAULT_FAR_ORIGIN_M,
} from '../ar/drift-monitor';

const base: DriftSample = {
  now: 100000,
  placed: true,
  tracking: 'normal',
  userInteracting: false,
  hasActiveMarker: false,
  lastResidualMm: null,
  lastRefineAt: null,
  refineInFlight: false,
};

describe('evaluateDrift', () => {
  it('is searching before placement', () => {
    const d = evaluateDrift({ ...base, placed: false });
    expect(d.state).toBe('searching');
    expect(d.shouldRefine).toBe(false);
  });

  it('is lost when tracking is unavailable', () => {
    const d = evaluateDrift({ ...base, tracking: 'unavailable' });
    expect(d.state).toBe('lost');
    expect(d.shouldRefine).toBe(false);
  });

  it('locks (no ICP) when a marker is active — markers are authoritative', () => {
    const d = evaluateDrift({ ...base, hasActiveMarker: true, lastResidualMm: 50 });
    expect(d.state).toBe('locked');
    expect(d.shouldRefine).toBe(false);
    expect(d.reason).toBe('marker-locked');
  });

  it('never refines on limited tracking (would bake in drift)', () => {
    const d = evaluateDrift({ ...base, tracking: 'limited' });
    expect(d.state).toBe('drifting');
    expect(d.shouldRefine).toBe(false);
  });

  it('refines when never refined yet (markerless, normal tracking, idle)', () => {
    const d = evaluateDrift({ ...base });
    expect(d.shouldRefine).toBe(true);
    expect(d.state).toBe('refining');
  });

  it('does NOT refine while the user is moving the model', () => {
    const d = evaluateDrift({ ...base, userInteracting: true });
    expect(d.shouldRefine).toBe(false);
    expect(d.reason).toBe('user-interacting');
  });

  it('throttles refines within the interval', () => {
    const d = evaluateDrift({
      ...base,
      lastResidualMm: 30,
      lastRefineAt: base.now - 1000, // 1 s ago, interval is 2.5 s
    });
    expect(d.shouldRefine).toBe(false);
    expect(d.reason).toBe('throttled');
  });

  it('refines again once the throttle interval has elapsed and residual is high', () => {
    const d = evaluateDrift({
      ...base,
      lastResidualMm: 30,
      lastRefineAt: base.now - DEFAULT_DRIFT_PARAMS.refineIntervalMs - 1,
    });
    expect(d.shouldRefine).toBe(true);
    expect(d.state).toBe('refining');
  });

  it('stays locked (no refine) when the last residual is within tolerance', () => {
    const d = evaluateDrift({
      ...base,
      lastResidualMm: 4, // ≤ goodResidualMm (8)
      lastRefineAt: base.now - 10000,
    });
    expect(d.state).toBe('locked');
    expect(d.shouldRefine).toBe(false);
    expect(d.reason).toBe('within-tolerance');
  });

  it('reports drifting when the residual exceeds the drift threshold but is throttled', () => {
    const d = evaluateDrift({
      ...base,
      lastResidualMm: 40, // ≥ driftResidualMm (20)
      lastRefineAt: base.now - 500,
    });
    expect(d.state).toBe('drifting');
    expect(d.shouldRefine).toBe(false);
  });

  it('does not stack refines when one is in flight', () => {
    const d = evaluateDrift({ ...base, refineInFlight: true });
    expect(d.shouldRefine).toBe(false);
    expect(d.state).toBe('refining');
  });
});

describe('lockStateLabel', () => {
  it('maps every state to a non-empty label', () => {
    for (const s of ['searching', 'locked', 'drifting', 'refining', 'lost'] as const) {
      expect(lockStateLabel(s).length).toBeGreaterThan(0);
    }
  });
});

describe('shouldTriggerRealign (alignment failure watcher)', () => {
  const t0 = 100000;
  it('never fires while a marker is actively driving the model', () => {
    expect(
      shouldTriggerRealign({ now: t0 + 999999, hasActiveMarker: true, driftingSince: t0 }),
    ).toBe(false);
  });

  it('does not fire when not currently drifting', () => {
    expect(shouldTriggerRealign({ now: t0, hasActiveMarker: false, driftingSince: null })).toBe(false);
  });

  it('does not fire before the threshold elapses', () => {
    const now = t0 + DEFAULT_FAILURE_PARAMS.failureThresholdMs - 1;
    expect(shouldTriggerRealign({ now, hasActiveMarker: false, driftingSince: t0 })).toBe(false);
  });

  it('fires once uncorrected drift exceeds the threshold', () => {
    const now = t0 + DEFAULT_FAILURE_PARAMS.failureThresholdMs + 1;
    expect(shouldTriggerRealign({ now, hasActiveMarker: false, driftingSince: t0 })).toBe(true);
  });
});

describe('isFarFromOrigin (float-precision guard)', () => {
  it('is false near the world origin', () => {
    expect(isFarFromOrigin(5)).toBe(false);
    expect(isFarFromOrigin(DEFAULT_FAR_ORIGIN_M)).toBe(false);
  });
  it('is true well beyond the threshold', () => {
    expect(isFarFromOrigin(DEFAULT_FAR_ORIGIN_M + 1)).toBe(true);
  });
  it('honours a custom threshold and ignores non-finite input', () => {
    expect(isFarFromOrigin(15, 10)).toBe(true);
    expect(isFarFromOrigin(NaN)).toBe(false);
  });
});
