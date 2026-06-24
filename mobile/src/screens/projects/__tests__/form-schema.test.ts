import {
  flattenComponents,
  isNativelyRenderable,
  isFieldVisible,
  validateField,
  validateForm,
  initialData,
  FormField,
} from '../qc-form/form-schema';

// Mirrors the real "Metal Fabrication QC Inspection Report" shape: panels wrapping fields.
const SCHEMA = {
  components: [
    {
      type: 'panel', title: 'Header', components: [
        { type: 'textfield', key: 'inspector', label: 'Inspector', validate: { required: true } },
        { type: 'datetime', key: 'date', label: 'Date' },
        { type: 'number', key: 'thickness', label: 'Thickness (mm)', validate: { min: 5, max: 50 } },
      ],
    },
    {
      type: 'columns', columns: [
        { components: [{ type: 'select', key: 'result', label: 'Result', data: { values: [{ label: 'Pass', value: 'pass' }, { label: 'Fail', value: 'fail' }] }, validate: { required: true } }] },
        { components: [{ type: 'textarea', key: 'defectNotes', label: 'Defect notes', conditional: { show: true, when: 'result', eq: 'fail' } }] },
      ],
    },
    { type: 'radio', key: 'weldType', label: 'Weld type', values: [{ label: 'Fillet', value: 'fillet' }, { label: 'Groove', value: 'groove' }] },
    { type: 'checkbox', key: 'visualOk', label: 'Visual OK' },
    { type: 'button', key: 'submit', label: 'Submit' }, // ignored
  ],
};

describe('flattenComponents', () => {
  it('walks panels + columns into a flat field list, dropping layout/button', () => {
    const { fields, unsupported } = flattenComponents(SCHEMA);
    expect(unsupported).toEqual([]);
    expect(fields.map((f) => f.key)).toEqual(['inspector', 'date', 'thickness', 'result', 'defectNotes', 'weldType', 'visualOk']);
  });
  it('parses options from data.values and values[]', () => {
    const { fields } = flattenComponents(SCHEMA);
    expect(fields.find((f) => f.key === 'result')!.options).toEqual([{ label: 'Pass', value: 'pass' }, { label: 'Fail', value: 'fail' }]);
    expect(fields.find((f) => f.key === 'weldType')!.options.map((o) => o.value)).toEqual(['fillet', 'groove']);
  });
  it('flags unsupported component types', () => {
    const r = flattenComponents({ components: [{ type: 'survey', key: 's' }, { type: 'textfield', key: 't' }] });
    expect(r.unsupported).toEqual(['survey']);
    expect(isNativelyRenderable({ components: [{ type: 'survey', key: 's' }] })).toBe(false);
    expect(isNativelyRenderable(SCHEMA)).toBe(true);
  });
  it('treats an empty schema as natively renderable (no fields)', () => {
    expect(flattenComponents({ components: [] }).fields).toEqual([]);
    expect(isNativelyRenderable({})).toBe(true);
  });
});

describe('conditional visibility', () => {
  const { fields } = flattenComponents(SCHEMA);
  const defectNotes = fields.find((f) => f.key === 'defectNotes')!;
  it('shows a conditional field only when its trigger matches', () => {
    expect(isFieldVisible(defectNotes, { result: 'fail' })).toBe(true);
    expect(isFieldVisible(defectNotes, { result: 'pass' })).toBe(false);
    expect(isFieldVisible(defectNotes, {})).toBe(false);
  });
});

describe('validation', () => {
  const { fields } = flattenComponents(SCHEMA);
  const byKey = Object.fromEntries(fields.map((f) => [f.key, f])) as Record<string, FormField>;

  it('enforces required + numeric range on visible fields', () => {
    expect(validateField(byKey.inspector, '')).toMatch(/required/i);
    expect(validateField(byKey.inspector, 'Sam')).toBeNull();
    expect(validateField(byKey.thickness, 2)).toMatch(/≥ 5/);
    expect(validateField(byKey.thickness, 60)).toMatch(/≤ 50/);
    expect(validateField(byKey.thickness, 20)).toBeNull();
    expect(validateField(byKey.thickness, undefined)).toBeNull(); // optional + empty
  });

  it('validateForm skips hidden/conditional-off fields', () => {
    // result=pass → defectNotes hidden; only required fields are inspector + result
    const bad = validateForm(fields, { result: '' });
    expect(bad.valid).toBe(false);
    expect(Object.keys(bad.errors).sort()).toEqual(['inspector', 'result']);

    const good = validateForm(fields, { inspector: 'Sam', result: 'pass' });
    expect(good.valid).toBe(true);

    // result=fail makes defectNotes visible but it's not required → still valid
    const failOk = validateForm(fields, { inspector: 'Sam', result: 'fail' });
    expect(failOk.valid).toBe(true);
  });

  it('selectboxes emptiness = no box ticked', () => {
    const sb: FormField = { key: 'checks', type: 'selectboxes', label: 'Checks', options: [], required: true };
    expect(validateField(sb, { a: false, b: false })).toMatch(/required/i);
    expect(validateField(sb, { a: true })).toBeNull();
  });
});

describe('initialData', () => {
  it('seeds defaults without clobbering existing values', () => {
    const fields: FormField[] = [
      { key: 'a', type: 'textfield', label: 'A', options: [], required: false, defaultValue: 'x' },
      { key: 'b', type: 'checkbox', label: 'B', options: [], required: false, defaultValue: true },
    ];
    expect(initialData(fields, { a: 'kept' })).toEqual({ a: 'kept', b: true });
  });
});
