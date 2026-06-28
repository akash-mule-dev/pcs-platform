/**
 * Pure helpers for rendering an import's pipeline progress as a 4-step stepper.
 * No React/RN imports so the mapping logic is unit-testable in isolation
 * (mirrors the backend stages uploaded→queued→extracting→persisting→converting
 * →completed|failed onto Upload · Extract · Build tree · Convert 3D).
 */

export type ImportStepState = 'done' | 'current' | 'error' | 'idle';

export const PIPELINE_STEPS = [
  { key: 'uploaded', label: 'Upload' },
  { key: 'extracting', label: 'Extract' },
  { key: 'persisting', label: 'Build tree' },
  { key: 'converting', label: 'Convert 3D' },
] as const;

/** Fine-grained backend stage → which of the 4 steps it belongs to. */
const STAGE_TO_STEP: Record<string, number> = {
  uploaded: 0,
  queued: 0,
  extracting: 1,
  persisting: 2,
  converting: 3,
};

export const IMPORT_STATUS_LABELS: Record<string, string> = {
  uploaded: 'Uploaded',
  queued: 'Queued',
  extracting: 'Extracting',
  persisting: 'Building tree',
  converting: 'Converting',
  completed: 'Completed',
  failed: 'Failed',
};

export interface PipelineRow {
  status: string;
  stage: string;
  nodeCount?: number | null;
  modelId?: string | null;
  conversionJobId?: string | null;
}

/**
 * Per-step state for the stepper. A completed import is all-done; a failed one
 * is reconstructed from the artifacts it left behind (modelId → conversionJobId
 * → nodeCount) so the failing step is marked even after a restart; an in-flight
 * one marks everything before its current stage done and the current stage live.
 */
export function stepStates(row: PipelineRow): ImportStepState[] {
  const states: ImportStepState[] = ['idle', 'idle', 'idle', 'idle'];

  if (row.status === 'completed') return states.map(() => 'done') as ImportStepState[];

  if (row.status === 'failed') {
    const reached = row.modelId ? 4 : row.conversionJobId ? 3 : row.nodeCount ? 2 : 1;
    for (let i = 0; i < states.length; i++) {
      if (i < reached) states[i] = 'done';
      else if (i === Math.min(reached, states.length - 1)) states[i] = 'error';
    }
    return states;
  }

  const current = STAGE_TO_STEP[row.stage] ?? 0;
  for (let i = 0; i < states.length; i++) {
    if (i < current) states[i] = 'done';
    else if (i === current) states[i] = 'current';
  }
  return states;
}
