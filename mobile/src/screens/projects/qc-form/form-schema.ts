/**
 * Pure interpreter for the (subset of) Form.io schema our QC templates use, so
 * reports can be rendered + filled NATIVELY (and offline) on the app while the
 * web Form.io builder stays the single template-authoring source of truth.
 *
 * Supported component types (from the active-template audit): textfield, textarea,
 * number, select, radio, checkbox, selectboxes, datetime, + panel/columns/fieldset
 * (layout). Anything else marks the schema "unsupported" so the caller can fall
 * back to the web WebView. No React/network imports — unit-testable in isolation.
 */

export type FieldType =
  | 'textfield' | 'textarea' | 'number' | 'select' | 'radio'
  | 'checkbox' | 'selectboxes' | 'datetime';

export const SUPPORTED_FIELD_TYPES: FieldType[] = [
  'textfield', 'textarea', 'number', 'select', 'radio', 'checkbox', 'selectboxes', 'datetime',
];
const LAYOUT_TYPES = new Set(['panel', 'columns', 'fieldset', 'well', 'container', 'table']);
// Rendered by the screen chrome, not as a field; never blocks support.
const IGNORED_TYPES = new Set(['button', 'content', 'htmlelement', 'hidden']);

export interface SelectOption { label: string; value: string }

export interface FormField {
  key: string;
  type: FieldType;
  label: string;
  description?: string;
  placeholder?: string;
  options: SelectOption[]; // for select/radio/selectboxes
  multiple?: boolean;      // select with multiple
  defaultValue?: unknown;
  required: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  /** Form.io simple conditional: show this field when data[when] equals `eq`. */
  conditional?: { show: boolean; when: string; eq: string };
  hidden?: boolean;
}

export interface FlattenResult {
  fields: FormField[];
  /** component types encountered that we cannot render natively */
  unsupported: string[];
}

function coerceOptions(comp: any): SelectOption[] {
  // select: data.values[] ; radio/selectboxes: values[]
  const raw = comp?.data?.values ?? comp?.values ?? [];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v: any) => ({ label: String(v?.label ?? v?.value ?? ''), value: String(v?.value ?? v?.label ?? '') }))
    .filter((o: SelectOption) => o.value !== '' || o.label !== '');
}

function toField(comp: any): FormField {
  const v = comp?.validate ?? {};
  const cond = comp?.conditional;
  const conditional =
    cond && typeof cond.when === 'string' && cond.when
      ? { show: cond.show === true || cond.show === 'true', when: String(cond.when), eq: String(cond.eq ?? '') }
      : undefined;
  return {
    key: String(comp.key),
    type: comp.type as FieldType,
    label: String(comp.label ?? comp.key),
    description: comp.description || undefined,
    placeholder: comp.placeholder || undefined,
    options: coerceOptions(comp),
    multiple: comp.type === 'select' ? !!comp.multiple : undefined,
    defaultValue: comp.defaultValue,
    required: !!v.required,
    min: typeof v.min === 'number' ? v.min : undefined,
    max: typeof v.max === 'number' ? v.max : undefined,
    minLength: typeof v.minLength === 'number' ? v.minLength : undefined,
    maxLength: typeof v.maxLength === 'number' ? v.maxLength : undefined,
    conditional,
    hidden: comp.hidden === true,
  };
}

/** Walk a Form.io component tree into a flat, ordered list of renderable fields. */
export function flattenComponents(schema: any): FlattenResult {
  const fields: FormField[] = [];
  const unsupported: string[] = [];
  const seen = new Set<string>();

  const walk = (comps: any[]): void => {
    for (const comp of comps ?? []) {
      if (!comp || typeof comp !== 'object') continue;
      const type = comp.type;
      if (LAYOUT_TYPES.has(type)) {
        if (Array.isArray(comp.components)) walk(comp.components);
        if (Array.isArray(comp.columns)) for (const col of comp.columns) walk(col?.components ?? []);
        if (Array.isArray(comp.rows)) for (const row of comp.rows) for (const cell of row ?? []) walk(cell?.components ?? []);
        continue;
      }
      if (IGNORED_TYPES.has(type)) continue;
      if (!SUPPORTED_FIELD_TYPES.includes(type)) { unsupported.push(type); continue; }
      if (!comp.key || seen.has(comp.key)) continue;
      seen.add(comp.key);
      fields.push(toField(comp));
    }
  };

  walk(schema?.components ?? []);
  return { fields, unsupported: [...new Set(unsupported)] };
}

/** True iff a schema can be fully rendered natively (no unsupported components, ≥0 fields). */
export function isNativelyRenderable(schema: any): boolean {
  return flattenComponents(schema).unsupported.length === 0;
}

/** Form.io simple-conditional visibility against the current form data. */
export function isFieldVisible(field: FormField, data: Record<string, any>): boolean {
  if (field.hidden) return false;
  if (!field.conditional) return true;
  const actual = data?.[field.conditional.when];
  const matches = String(actual ?? '') === field.conditional.eq;
  return field.conditional.show ? matches : !matches;
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.values(value as object).every((v) => !v); // selectboxes: no box ticked
  return false;
}

/** Validate one field's value → human error string, or null if valid. */
export function validateField(field: FormField, value: unknown): string | null {
  if (field.required && isEmpty(value)) return `${field.label} is required.`;
  if (isEmpty(value)) return null; // optional + empty → fine
  if (field.type === 'number') {
    const n = typeof value === 'number' ? value : parseFloat(String(value));
    if (Number.isNaN(n)) return `${field.label} must be a number.`;
    if (field.min !== undefined && n < field.min) return `${field.label} must be ≥ ${field.min}.`;
    if (field.max !== undefined && n > field.max) return `${field.label} must be ≤ ${field.max}.`;
  }
  if (typeof value === 'string') {
    if (field.minLength !== undefined && value.length < field.minLength) return `${field.label} must be at least ${field.minLength} characters.`;
    if (field.maxLength !== undefined && value.length > field.maxLength) return `${field.label} must be at most ${field.maxLength} characters.`;
  }
  return null;
}

export interface ValidationResult { valid: boolean; errors: Record<string, string> }

/** Validate every VISIBLE field (hidden/conditional-off fields are not enforced). */
export function validateForm(fields: FormField[], data: Record<string, any>): ValidationResult {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    if (!isFieldVisible(f, data)) continue;
    const err = validateField(f, data?.[f.key]);
    if (err) errors[f.key] = err;
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

/** Seed a data object from the schema's defaultValues (only for visible-by-default fields). */
export function initialData(fields: FormField[], existing?: Record<string, any> | null): Record<string, any> {
  const data: Record<string, any> = { ...(existing ?? {}) };
  for (const f of fields) {
    if (data[f.key] === undefined && f.defaultValue !== undefined) data[f.key] = f.defaultValue;
  }
  return data;
}
