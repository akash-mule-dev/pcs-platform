/**
 * Report-template types — Form.io templates that drive QC reports, NCRs and
 * checklists. Mirrors the backend `TemplateType` enum
 * (backend/src/templates/entities/form-template.entity.ts). Shared by the
 * templates list and the editor dialog so the two can never drift.
 */
export const TEMPLATE_TYPES: string[] = ['inspection', 'checklist', 'ncr', 'capa', 'other'];

export const TEMPLATE_TYPE_LABEL: Record<string, string> = {
  inspection: 'Inspection', checklist: 'Checklist', ncr: 'NCR', capa: 'CAPA', other: 'Other',
};
