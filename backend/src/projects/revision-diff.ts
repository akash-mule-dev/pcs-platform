/**
 * Revision diff — pure module (no Nest/TypeORM imports, unit-testable).
 *
 * Compares the nodes extracted from a newly imported model file against the
 * project's CURRENT assembly tree (matched by the stable `ifc_guid`) and
 * classifies every piece as added / changed / missing / unchanged. "Missing"
 * means "in the project tree but not in this file" — for single-model projects
 * that is a removal; for multi-file projects it may simply be outside this
 * file's scope, so the label stays honest.
 *
 * Field-level deltas cover the fabrication-relevant promoted columns; numeric
 * comparisons use small tolerances so float noise from re-exports doesn't
 * produce phantom changes.
 */

export interface DiffIncomingNode {
  externalId: string;
  type: string;
  name: string;
  mark: string | null;
  quantity: number;
  profile: string | null;
  materialGrade: string | null;
  lengthMm: number | null;
  weightKg: number | null;
}

export interface DiffExistingNode {
  ifcGuid: string | null;
  nodeType: string;
  name: string;
  mark: string | null;
  quantity: number;
  profile: string | null;
  materialGrade: string | null;
  lengthMm: number | null;
  weightKg: number | null;
}

export interface FieldDelta { field: string; from: unknown; to: unknown; }

export interface DiffEntry {
  guid: string;
  mark: string | null;
  name: string;
  type: string;
  profile?: string | null;
  deltas?: FieldDelta[];
}

export interface RevisionDiff {
  /** True when the project tree was empty before this import (initial load). */
  initial: boolean;
  counts: { incoming: number; added: number; changed: number; missing: number; unchanged: number };
  added: DiffEntry[];
  changed: DiffEntry[];
  missing: DiffEntry[];
  /** Entry lists are capped (counts are not) so the stored jsonb stays bounded. */
  capped: boolean;
}

const LENGTH_TOLERANCE_MM = 0.5;
const WEIGHT_TOLERANCE_KG = 0.05;
const DEFAULT_CAP = 500;

function numChanged(a: number | null, b: number | null, tol: number): boolean {
  if (a == null && b == null) return false;
  if (a == null || b == null) return true;
  return Math.abs(a - b) > tol;
}

function strChanged(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '') !== (b ?? '');
}

/** Field-level deltas between the tree node and the incoming node (empty = unchanged). */
export function nodeDeltas(existing: DiffExistingNode, incoming: DiffIncomingNode): FieldDelta[] {
  const deltas: FieldDelta[] = [];
  if (strChanged(existing.name, incoming.name)) deltas.push({ field: 'name', from: existing.name, to: incoming.name });
  if (strChanged(existing.mark, incoming.mark)) deltas.push({ field: 'mark', from: existing.mark, to: incoming.mark });
  if (strChanged(existing.nodeType, incoming.type)) deltas.push({ field: 'type', from: existing.nodeType, to: incoming.type });
  if ((existing.quantity ?? 1) !== (incoming.quantity ?? 1)) deltas.push({ field: 'quantity', from: existing.quantity ?? 1, to: incoming.quantity ?? 1 });
  if (strChanged(existing.profile, incoming.profile)) deltas.push({ field: 'profile', from: existing.profile, to: incoming.profile });
  if (strChanged(existing.materialGrade, incoming.materialGrade)) deltas.push({ field: 'materialGrade', from: existing.materialGrade, to: incoming.materialGrade });
  if (numChanged(existing.lengthMm, incoming.lengthMm, LENGTH_TOLERANCE_MM)) deltas.push({ field: 'lengthMm', from: existing.lengthMm, to: incoming.lengthMm });
  if (numChanged(existing.weightKg, incoming.weightKg, WEIGHT_TOLERANCE_KG)) deltas.push({ field: 'weightKg', from: existing.weightKg, to: incoming.weightKg });
  return deltas;
}

export function computeRevisionDiff(
  incoming: DiffIncomingNode[],
  existing: DiffExistingNode[],
  cap: number = DEFAULT_CAP,
): RevisionDiff {
  const existingByGuid = new Map<string, DiffExistingNode>();
  for (const e of existing) if (e.ifcGuid) existingByGuid.set(e.ifcGuid, e);

  const initial = existingByGuid.size === 0;
  const added: DiffEntry[] = [];
  const changed: DiffEntry[] = [];
  const missing: DiffEntry[] = [];
  let addedCount = 0;
  let changedCount = 0;
  let unchangedCount = 0;
  let capped = false;

  const push = (arr: DiffEntry[], entry: DiffEntry) => {
    if (arr.length < cap) arr.push(entry);
    else capped = true;
  };

  const seen = new Set<string>();
  for (const inc of incoming) {
    seen.add(inc.externalId);
    const ex = existingByGuid.get(inc.externalId);
    if (!ex) {
      addedCount++;
      push(added, { guid: inc.externalId, mark: inc.mark, name: inc.name, type: inc.type, profile: inc.profile });
      continue;
    }
    const deltas = nodeDeltas(ex, inc);
    if (deltas.length > 0) {
      changedCount++;
      push(changed, { guid: inc.externalId, mark: inc.mark ?? ex.mark, name: inc.name, type: inc.type, profile: inc.profile, deltas });
    } else {
      unchangedCount++;
    }
  }

  let missingCount = 0;
  for (const [guid, ex] of existingByGuid) {
    if (seen.has(guid)) continue;
    missingCount++;
    push(missing, { guid, mark: ex.mark, name: ex.name, type: ex.nodeType, profile: ex.profile });
  }

  return {
    initial,
    counts: { incoming: incoming.length, added: addedCount, changed: changedCount, missing: missingCount, unchanged: unchangedCount },
    added,
    changed,
    missing,
    capped,
  };
}

/** One-line human summary for the import event timeline. */
export function revisionSummaryMessage(diff: RevisionDiff): string {
  if (diff.initial) return `Initial import: ${diff.counts.incoming} nodes loaded`;
  const c = diff.counts;
  if (c.added === 0 && c.changed === 0 && c.missing === 0) return `Revision check: no design changes (${c.unchanged} nodes identical)`;
  return `Revision changes: +${c.added} new, ~${c.changed} changed, −${c.missing} not in this file (${c.unchanged} unchanged)`;
}
