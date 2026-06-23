import {
  prettifyLabel,
  prettifyPset,
  formatPropValue,
  pickProp,
  groupNodeProperties,
  buildFabricationRows,
  formatLength,
  formatWeight,
  ifcClassLabel,
  nodeTypeLabel,
} from '../assembly-info';

describe('prettifyLabel', () => {
  it('splits camelCase and snake_case into Title Case', () => {
    expect(prettifyLabel('MaterialGrade')).toBe('Material Grade');
    expect(prettifyLabel('Released_For_Fab_Date')).toBe('Released For Fab Date');
    expect(prettifyLabel('Member_Number')).toBe('Member Number');
    expect(prettifyLabel('SkewedAngleX')).toBe('Skewed Angle X');
  });
  it('preserves known acronyms and uppercases single letters', () => {
    expect(prettifyLabel('SDS2_Unified')).toBe('SDS2 Unified');
    expect(prettifyLabel('PROFILE')).toBe('Profile');
  });
});

describe('prettifyPset', () => {
  it('strips AISC / Pset / Qto prefixes', () => {
    expect(prettifyPset('AISC_EM11_Pset_Material')).toBe('Material');
    expect(prettifyPset('AISC_EM11_Pset_PieceIdentification')).toBe('Piece Identification');
    expect(prettifyPset('AISC_EM11_Pset_SkewedEnd_2')).toBe('Skewed End 2');
    expect(prettifyPset('Qto_BeamQuantities')).toBe('Beam Quantities');
  });
  it('maps Default to General and keeps SDS2_Unified readable', () => {
    expect(prettifyPset('Default')).toBe('General');
    expect(prettifyPset('SDS2_Unified')).toBe('SDS2 Unified');
  });
});

describe('formatPropValue', () => {
  it('drops empty values, keeps zero/false, maps booleans', () => {
    expect(formatPropValue(null)).toBeNull();
    expect(formatPropValue('')).toBeNull();
    expect(formatPropValue('   ')).toBeNull();
    expect(formatPropValue(0)).toBe('0');
    expect(formatPropValue(true)).toBe('Yes');
    expect(formatPropValue(false)).toBe('No');
    expect(formatPropValue('300W')).toBe('300W');
    expect(formatPropValue({})).toBeNull();
    expect(formatPropValue(['a', '', 'b'])).toBe('a, b');
  });
});

describe('groupNodeProperties', () => {
  // A realistic part bag straight out of the import (bare + dotted twins).
  const partProps = {
    PROFILE: 'L6X6X5/16',
    MATERIAL: '300W',
    PieceMark: 'ANGLE',
    PrelimMark: '',
    MainPieceTag: true,
    MaterialType: 'STEEL',
    MaterialGrade: '300W',
    IndicationMark: 'A1006',
    'Default.PROFILE': 'L6X6X5/16',
    'Default.MATERIAL': '300W',
    'AISC_EM11_Pset_Material.MaterialType': 'STEEL',
    'AISC_EM11_Pset_Material.MaterialGrade': '300W',
    'AISC_EM11_Pset_PieceIdentification.PieceMark': 'ANGLE',
    'AISC_EM11_Pset_PieceIdentification.PrelimMark': '',
    'AISC_EM11_Pset_PieceIdentification.MainPieceTag': true,
    'AISC_EM11_Pset_PieceIdentification.IndicationMark': 'A1006',
  };

  it('groups by Pset and drops bare duplicates of grouped leaves', () => {
    const groups = groupNodeProperties(partProps);
    const titles = groups.map((g) => g.title);
    expect(titles).toContain('Material');
    expect(titles).toContain('Piece Identification');
    expect(titles).toContain('General');

    // Bare PieceMark/MaterialGrade are dupes of dotted leaves → not in General.
    const general = groups.find((g) => g.title === 'General')!;
    const generalLabels = general.rows.map((r) => r.label);
    expect(generalLabels).not.toContain('Piece Mark');
    expect(generalLabels).not.toContain('Material Grade');
  });

  it('filters empty values and never emits an empty group', () => {
    const groups = groupNodeProperties(partProps);
    for (const g of groups) {
      expect(g.rows.length).toBeGreaterThan(0);
      for (const r of g.rows) expect(r.value).not.toBe('');
    }
    const piece = groups.find((g) => g.title === 'Piece Identification')!;
    expect(piece.rows.find((r) => r.label === 'Prelim Mark')).toBeUndefined();
    expect(piece.rows.find((r) => r.label === 'Main Piece Tag')?.value).toBe('Yes');
  });

  it('orders priority sections first and General last', () => {
    const titles = groupNodeProperties(partProps).map((g) => g.title);
    expect(titles.indexOf('Piece Identification')).toBeLessThan(titles.indexOf('Material'));
    expect(titles[titles.length - 1]).toBe('General');
  });

  it('handles a null / empty bag', () => {
    expect(groupNodeProperties(null)).toEqual([]);
    expect(groupNodeProperties({})).toEqual([]);
  });
});

describe('buildFabricationRows', () => {
  it('uses promoted columns when present', () => {
    const rows = buildFabricationRows(
      { profile: 'UC203x203x46', materialGrade: 'S355', lengthMm: 6000, weightKg: 276, quantity: 2 },
      null,
    );
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(byLabel['Profile / section']).toBe('UC203x203x46');
    expect(byLabel['Material grade']).toBe('S355');
    expect(byLabel['Length']).toContain('6000 mm');
    expect(byLabel['Length']).toContain('6.00 m');
    expect(byLabel['Weight']).toBe('276 kg');
    expect(byLabel['Quantity (in design)']).toBe('×2');
  });

  it('falls back to the properties bag when columns are blank', () => {
    const rows = buildFabricationRows(
      { profile: null, materialGrade: null, lengthMm: null, weightKg: null, quantity: 1 },
      { PROFILE: 'L6X6X5/16', 'AISC_EM11_Pset_Material.MaterialGrade': '300W', 'AISC_EM11_Pset_Material.MaterialType': 'STEEL' },
    );
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(byLabel['Profile / section']).toBe('L6X6X5/16');
    expect(byLabel['Material grade']).toBe('300W');
    expect(byLabel['Material type']).toBe('STEEL');
  });

  it('suppresses material type when it equals the grade', () => {
    const rows = buildFabricationRows({}, { MaterialGrade: 'STEEL', MaterialType: 'steel' });
    expect(rows.find((r) => r.label === 'Material type')).toBeUndefined();
  });
});

describe('formatters & labels', () => {
  it('formatLength / formatWeight', () => {
    expect(formatLength(203.2)).toBe('203.2 mm');
    expect(formatLength(1500)).toBe('1500 mm  ·  1.50 m');
    expect(formatLength(null)).toBeNull();
    expect(formatWeight(12.34)).toBe('12.3 kg');
    expect(formatWeight(1200)).toBe('1200 kg  ·  1.20 t');
  });
  it('ifcClassLabel / nodeTypeLabel', () => {
    expect(ifcClassLabel('IFCBEAM')).toBe('Beam');
    expect(ifcClassLabel('IFCELEMENTASSEMBLY')).toBe('Assembly');
    expect(ifcClassLabel('IFCSOMETHINGNEW')).toBe('Somethingnew');
    expect(ifcClassLabel(null)).toBeNull();
    expect(nodeTypeLabel('subassembly')).toBe('Subassembly');
    expect(nodeTypeLabel(null)).toBe('Item');
  });

  it('pickProp returns the first non-empty candidate verbatim', () => {
    const props = { A: '', B: '  ', C: 'value', D: 'other' };
    expect(pickProp(props, ['A', 'B', 'C', 'D'])).toBe('value');
    expect(pickProp(props, ['A', 'B'])).toBeNull();
    expect(pickProp(null, ['A'])).toBeNull();
  });
});
