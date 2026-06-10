/**
 * Pure status roll-up math — no NestJS/TypeORM imports, so it is unit-testable
 * in isolation. Status/stage values are the same strings the enums use.
 */
export type ProdStatus = 'not_started' | 'in_progress' | 'ready_to_ship' | 'shipped' | 'on_hold';
export type StageStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';
export interface Rollup { status: ProdStatus; percentComplete: number; currentStageId: string | null; }
export interface TreeNode { id: string; parentId: string | null; depth: number; }

/** A fabricated node's status from its work-order stages. */
export function leafFromStages(
  stages: { status: StageStatus; stageId: string; sequence?: number }[],
  qtyShipped = 0,
  quantity = 1,
): Rollup {
  const total = stages.length;
  if (!total) return { status: 'not_started', percentComplete: 0, currentStageId: null };
  const ordered = [...stages].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  const isDone = (s: StageStatus) => s === 'completed' || s === 'skipped';
  const done = ordered.filter((s) => isDone(s.status)).length;
  const anyProg = ordered.some((s) => s.status === 'in_progress');
  const percent = Math.round((done / total) * 10000) / 100;
  // "Active" stage = where work is happening now: the first in-progress stage,
  // else the first not-yet-done stage. Order-independent — stages can be worked
  // out of sequence, so this is a hint, not a constraint.
  const active = ordered.find((s) => s.status === 'in_progress') ?? ordered.find((s) => !isDone(s.status));
  let status: ProdStatus;
  if (done === total) status = qtyShipped >= quantity && quantity > 0 ? 'shipped' : 'ready_to_ship';
  else if (done > 0 || anyProg) status = 'in_progress';
  else status = 'not_started';
  return { status, percentComplete: percent, currentStageId: active ? active.stageId : null };
}

/** Combine child statuses into a parent/group status. */
export function aggregateStatus(children: ProdStatus[]): ProdStatus | null {
  if (!children.length) return null;
  if (children.every((s) => s === 'shipped')) return 'shipped';
  if (children.every((s) => s === 'shipped' || s === 'ready_to_ship')) return 'ready_to_ship';
  if (children.some((s) => s === 'on_hold')) return 'on_hold';
  if (children.some((s) => s === 'in_progress' || s === 'ready_to_ship' || s === 'shipped')) return 'in_progress';
  return 'not_started';
}

/** Roll leaf statuses up through the tree; parts without a WO inherit their ancestor. */
export function aggregateTree(nodes: TreeNode[], leaf: Map<string, Rollup>): Map<string, Rollup> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenByParent = new Map<string, string[]>();
  for (const n of nodes) if (n.parentId) { const a = childrenByParent.get(n.parentId) ?? []; a.push(n.id); childrenByParent.set(n.parentId, a); }
  const result = new Map<string, Rollup>(leaf);
  for (const n of [...nodes].sort((a, b) => b.depth - a.depth)) {
    if (result.has(n.id)) continue;
    const kids = (childrenByParent.get(n.id) ?? []).map((id) => result.get(id)).filter(Boolean) as Rollup[];
    if (kids.length) {
      const status = aggregateStatus(kids.map((k) => k.status)) ?? 'not_started';
      const percent = Math.round((kids.reduce((s, k) => s + k.percentComplete, 0) / kids.length) * 100) / 100;
      result.set(n.id, { status, percentComplete: percent, currentStageId: null });
    }
  }
  for (const n of [...nodes].sort((a, b) => a.depth - b.depth)) {
    if (result.has(n.id)) continue;
    let p = n.parentId; let inh: Rollup | undefined;
    while (p) { if (result.has(p)) { inh = result.get(p); break; } p = byId.get(p)?.parentId ?? null; }
    if (inh) result.set(n.id, { status: inh.status, percentComplete: inh.percentComplete, currentStageId: null });
  }
  return result;
}

export interface BranchInput {
  changedNodeId: string;
  changedLeaf: Rollup;
  /** Subtree under the changed node (each with its parentId). */
  descendants: { id: string; parentId: string }[];
  /** Nodes (in the subtree) that carry their own work order — inheritance stops there. */
  woNodeIds: Set<string>;
  /** Ancestor chain, parent -> root, with whether each has its own WO + its direct child ids. */
  ancestors: { id: string; hasWo: boolean; childIds: string[] }[];
  /** Current stored rollups for ancestors' (sibling) children. */
  current: Map<string, Rollup>;
}

/**
 * Compute status updates for ONLY the branch affected by a changed work order:
 * the changed node, the part-descendants that inherit it (stopping at any node
 * with its own WO), and the non-WO ancestors re-aggregated from their children.
 * Pure + unit-testable; the service supplies the gathered branch data.
 */
export function branchRollup(input: BranchInput): Map<string, Rollup> {
  const { changedNodeId, changedLeaf, descendants, woNodeIds, ancestors, current } = input;
  const out = new Map<string, Rollup>();
  out.set(changedNodeId, changedLeaf);

  const childrenByParent = new Map<string, string[]>();
  for (const d of descendants) { const a = childrenByParent.get(d.parentId) ?? []; a.push(d.id); childrenByParent.set(d.parentId, a); }
  const queue = [...(childrenByParent.get(changedNodeId) ?? [])];
  while (queue.length) {
    const id = queue.shift()!;
    if (woNodeIds.has(id)) continue; // independent fabricated branch
    out.set(id, { status: changedLeaf.status, percentComplete: changedLeaf.percentComplete, currentStageId: null });
    queue.push(...(childrenByParent.get(id) ?? []));
  }

  for (const a of ancestors) {
    if (a.hasWo) continue; // a fabricated assembly's status is its own, not its children's
    const kids = a.childIds.map((id) => out.get(id) ?? current.get(id)).filter(Boolean) as Rollup[];
    const status = aggregateStatus(kids.map((k) => k.status)) ?? 'not_started';
    const percent = kids.length ? Math.round((kids.reduce((s, k) => s + k.percentComplete, 0) / kids.length) * 100) / 100 : 0;
    out.set(a.id, { status, percentComplete: percent, currentStageId: null });
  }
  return out;
}
