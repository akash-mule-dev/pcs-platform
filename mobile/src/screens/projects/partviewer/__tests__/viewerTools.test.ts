import { buildColorBy, referenceLengthsFrom, formatMm, CATEGORY_PALETTE, OTHER_COLOR } from '../viewerTools';
import { MNode } from '../../../../services/projects.service';

function node(p: Partial<MNode>): MNode {
  return {
    id: p.id ?? 'n', projectId: 'pr', parentId: p.parentId ?? null, nodeType: p.nodeType ?? 'part',
    name: p.name ?? 'n', quantity: 1, profile: p.profile ?? null, materialGrade: p.materialGrade ?? null,
    ifcGuid: p.ifcGuid ?? null, meshName: p.meshName ?? null, lengthMm: p.lengthMm ?? null, weightKg: p.weightKg ?? null,
  };
}

const hex = (h: string) => parseInt(h.replace('#', ''), 16);

describe('formatMm', () => {
  it('formats mm / m and handles missing/uncalibrated values', () => {
    expect(formatMm(450)).toBe('450 mm');
    expect(formatMm(2500)).toBe('2.50 m');
    expect(formatMm(15000)).toBe('15.0 m');
    expect(formatMm(null)).toBe('—');
    expect(formatMm(NaN)).toBe('—');
  });
});

describe('referenceLengthsFrom', () => {
  it('keeps only meshed parts with a positive length', () => {
    const refs = referenceLengthsFrom([
      node({ ifcGuid: 'a', lengthMm: 1000 }),
      node({ meshName: 'b', lengthMm: 2000 }),
      node({ ifcGuid: 'c', lengthMm: 0 }),     // dropped: no length
      node({ lengthMm: 500 }),                  // dropped: no mesh handle
      node({ ifcGuid: 'd' }),                   // dropped: no length
    ]);
    expect(refs).toEqual([
      { name: 'a', lengthMm: 1000 },
      { name: 'b', lengthMm: 2000 },
    ]);
  });
});

describe('buildColorBy', () => {
  const nodes = [
    node({ ifcGuid: 'm1', profile: 'W310', materialGrade: '350W' }),
    node({ ifcGuid: 'm2', profile: 'W310', materialGrade: '300W' }),
    node({ ifcGuid: 'm3', profile: 'HSS89', materialGrade: '350W' }),
    node({ ifcGuid: 'm4', profile: null, materialGrade: '350W' }),
  ];

  it('returns nothing for "none"', () => {
    expect(buildColorBy(nodes, 'none', null)).toEqual({ colors: {}, legend: [] });
  });

  it('colours by profile: most common first, missing → Other, with counts', () => {
    const { colors, legend } = buildColorBy(nodes, 'profile', null);
    // W310 (2) ranks before HSS89 (1); the null-profile node falls into Other.
    expect(legend[0]).toEqual({ label: 'W310', hex: CATEGORY_PALETTE[0], count: 2 });
    expect(legend[1]).toEqual({ label: 'HSS89', hex: CATEGORY_PALETTE[1], count: 1 });
    expect(legend[legend.length - 1]).toEqual({ label: 'Other', hex: OTHER_COLOR, count: 1 });
    expect(colors['m1']).toBe(hex(CATEGORY_PALETTE[0]));
    expect(colors['m3']).toBe(hex(CATEGORY_PALETTE[1]));
    expect(colors['m4']).toBe(hex(OTHER_COLOR));
  });

  it('colours by grade: distinct labels + counts from the same nodes', () => {
    const { colors, legend } = buildColorBy(nodes, 'grade', null);
    // 350W (3) ranks before 300W (1); no missing grade → no Other bucket.
    expect(legend[0]).toEqual({ label: '350W', hex: CATEGORY_PALETTE[0], count: 3 });
    expect(legend[1]).toEqual({ label: '300W', hex: CATEGORY_PALETTE[1], count: 1 });
    expect(legend.some((e) => e.label === 'Other')).toBe(false);
    expect(colors['m1']).toBe(hex(CATEGORY_PALETTE[0]));
    expect(colors['m2']).toBe(hex(CATEGORY_PALETTE[1]));
  });

  it('scopes to the isolated mesh set', () => {
    const { colors } = buildColorBy(nodes, 'profile', ['m1']);
    expect(colors['m1']).toBeDefined();
    expect(colors['m2']).toBeUndefined();
    expect(colors['m3']).toBeUndefined();
  });
});
