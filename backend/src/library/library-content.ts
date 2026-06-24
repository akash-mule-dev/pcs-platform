/**
 * Pure definitions + copy logic for the shared library ("super company").
 * No Nest/TypeORM imports — unit-testable in isolation.
 *
 * The library is a set of master processes & form templates owned by the single
 * platform organization. Publishing copies them into a tenant org, tracked by
 * `libraryOriginId` so a re-publish updates the tenant's copy in place instead
 * of duplicating it.
 */

export interface LibraryStageSeed {
  name: string;
  targetTimeSeconds: number;
  description?: string;
  requiresInspection?: boolean;
  /** ITP intent — a 'hold' point gates on its own stage's NCRs (see qc-gate.ts). */
  inspectionType?: 'hold' | 'witness' | 'review' | null;
  /** Marks the terminal FINAL QC / release gate (consolidates all stages' QC). */
  isFinalQc?: boolean;
}

/**
 * The default terminal FINAL QC / release stage appended to a routing: a hold
 * point that consolidates every prior stage's QC and releases the piece for
 * shipping. Shared by the library seed and `ProcessesService` so the
 * auto-append and the seeded routing stay identical.
 */
export const FINAL_QC_STAGE: LibraryStageSeed = {
  name: 'Final QC',
  targetTimeSeconds: 1800,
  description:
    'Final dimensional + coating + marking check; consolidates every stage’s QC and releases the piece for shipping — blocked while any NCR is open.',
  inspectionType: 'hold',
  requiresInspection: true,
  isFinalQc: true,
};

export interface LibraryProcessSeed {
  /** Stable key used to find-or-create the master copy in the platform org. */
  name: string;
  version?: number;
  stages: LibraryStageSeed[];
}

export interface LibraryTemplateSeed {
  name: string;
  type: 'ncr' | 'inspection' | 'checklist' | 'capa' | 'other';
  schema: Record<string, any>;
}

/**
 * Default content seeded into the platform library on boot. Editing these only
 * affects NEW seeds / explicit re-publishes — tenants own their copies once
 * published. Keep the process name in sync with the on-demand "Standard
 * Fabrication" routing so the two never collide inside a tenant.
 */
export const DEFAULT_LIBRARY_PROCESSES: LibraryProcessSeed[] = [
  {
    name: 'Standard Fabrication',
    version: 1,
    stages: [
      { name: 'Cutting', targetTimeSeconds: 1800, description: 'Cut raw stock to size' },
      { name: 'Fit-Up', targetTimeSeconds: 3600, description: 'Assemble and tack the parts' },
      { name: 'Welding', targetTimeSeconds: 7200, description: 'Full welds per WPS' },
      { name: 'Painting', targetTimeSeconds: 3600, description: 'Surface prep and coating' },
      FINAL_QC_STAGE,
    ],
  },
];

export const DEFAULT_LIBRARY_TEMPLATES: LibraryTemplateSeed[] = [
  {
    name: 'Non-Conformance Report',
    type: 'ncr',
    schema: {
      fields: [
        { key: 'defectType', label: 'Defect type', type: 'select', required: true,
          options: ['Dimensional', 'Weld', 'Material', 'Surface/Coating', 'Documentation', 'Other'] },
        { key: 'severity', label: 'Severity', type: 'select', required: true, options: ['Low', 'Medium', 'High', 'Critical'] },
        { key: 'description', label: 'Description of non-conformance', type: 'textarea', required: true },
        { key: 'quantityAffected', label: 'Quantity affected', type: 'number' },
        { key: 'rootCause', label: 'Suspected root cause', type: 'textarea' },
      ],
    },
  },
  {
    name: 'Dimensional Inspection',
    type: 'inspection',
    schema: {
      fields: [
        { key: 'memberMark', label: 'Member mark', type: 'text', required: true },
        { key: 'overallLength', label: 'Overall length (mm)', type: 'number', required: true },
        { key: 'tolerance', label: 'Within tolerance?', type: 'select', required: true, options: ['Yes', 'No'] },
        { key: 'weldVisual', label: 'Weld visual acceptable?', type: 'select', options: ['Yes', 'No', 'N/A'] },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ],
    },
  },
  {
    name: 'Fit-Up Checklist',
    type: 'checklist',
    schema: {
      fields: [
        { key: 'partsVerified', label: 'All parts verified against drawing', type: 'checkbox' },
        { key: 'gapsCorrect', label: 'Root gaps within spec', type: 'checkbox' },
        { key: 'tackWelds', label: 'Tack welds acceptable', type: 'checkbox' },
        { key: 'squareness', label: 'Squareness checked', type: 'checkbox' },
      ],
    },
  },
];

// ── copy mappers (pure) ──────────────────────────────────────────────────────

export interface ProcessRow {
  id: string;
  name: string;
  version: number;
  organizationId: string | null;
  libraryOriginId: string | null;
}
export interface StageRow {
  name: string;
  sequence: number;
  targetTimeSeconds: number;
  description?: string | null;
  requiresInspection?: boolean;
  inspectionType?: 'hold' | 'witness' | 'review' | null;
  isFinalQc?: boolean | null;
  hourlyRate?: number | null;
}
export interface TemplateRow {
  id: string;
  name: string;
  type: string;
  schema: Record<string, any> | null;
  version: number;
  organizationId: string | null;
  libraryOriginId: string | null;
}

/** Scalar fields for a tenant copy of a library process. */
export function processCopyFields(source: ProcessRow, targetOrgId: string): Partial<ProcessRow> {
  return {
    name: source.name,
    version: source.version,
    organizationId: targetOrgId,
    libraryOriginId: source.id,
  };
}

/** A library stage projected onto a target process (new row, no id). */
export function stageCopyFields(source: StageRow, targetProcessId: string, targetOrgId: string): StageRow & {
  processId: string;
  organizationId: string;
} {
  return {
    name: source.name,
    sequence: source.sequence,
    targetTimeSeconds: source.targetTimeSeconds,
    description: source.description ?? null,
    requiresInspection: !!source.requiresInspection,
    inspectionType: source.inspectionType ?? null,
    isFinalQc: source.isFinalQc ?? null,
    hourlyRate: source.hourlyRate ?? null,
    processId: targetProcessId,
    organizationId: targetOrgId,
  };
}

/** Scalar fields for a tenant copy of a library template. */
export function templateCopyFields(source: TemplateRow, targetOrgId: string): Partial<TemplateRow> {
  return {
    name: source.name,
    type: source.type,
    schema: source.schema ? JSON.parse(JSON.stringify(source.schema)) : null,
    version: source.version,
    organizationId: targetOrgId,
    libraryOriginId: source.id,
  };
}

/**
 * Reconcile a target process's stages against the library master, keyed by
 * `sequence` (no deletes → never breaks work-order FKs): returns which library
 * stages must be inserted and which existing rows to update in place.
 */
export function reconcileStagesBySequence(
  librarySorted: StageRow[],
  existingBySequence: Map<number, { id: string }>,
): { toInsert: StageRow[]; toUpdate: Array<{ id: string; fields: StageRow }> } {
  const toInsert: StageRow[] = [];
  const toUpdate: Array<{ id: string; fields: StageRow }> = [];
  for (const s of librarySorted) {
    const existing = existingBySequence.get(s.sequence);
    if (existing) toUpdate.push({ id: existing.id, fields: s });
    else toInsert.push(s);
  }
  return { toInsert, toUpdate };
}
