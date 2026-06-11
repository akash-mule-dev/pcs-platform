/**
 * Pure project design-summary aggregation — no NestJS/TypeORM deps, so unit-testable.
 * Production tracking (status, %, funnel) lives on each production order, NOT on
 * the project: a project is a pure design container that can back many orders.
 */
export type PType = 'group' | 'assembly' | 'subassembly' | 'part';

export interface PNode { nodeType: PType; weightKg: number | null; quantity: number; }
export interface ProjectProgress {
  nodes: { total: number; group: number; assembly: number; subassembly: number; part: number };
  tonnage: { totalKg: number };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function computeProgress(nodes: PNode[]): ProjectProgress {
  const nodeCounts = { total: nodes.length, group: 0, assembly: 0, subassembly: 0, part: 0 };
  let totalKg = 0;

  for (const n of nodes) {
    nodeCounts[n.nodeType]++;
    if (n.nodeType === 'part') totalKg += (n.weightKg || 0) * (n.quantity || 1);
  }

  return { nodes: nodeCounts, tonnage: { totalKg: r1(totalKg) } };
}
