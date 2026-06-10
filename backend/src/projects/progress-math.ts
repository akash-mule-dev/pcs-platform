/** Pure project-progress aggregation — no NestJS/TypeORM deps, so unit-testable. */
export type PType = 'group' | 'assembly' | 'subassembly' | 'part';
export type PStatus = 'not_started' | 'in_progress' | 'ready_to_ship' | 'shipped' | 'on_hold';
export type SStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

export interface PNode { nodeType: PType; productionStatus: PStatus; percentComplete: number; weightKg: number | null; quantity: number; }
export interface PStageRow { name: string; sequence: number; status: SStatus; }
export interface StageBucket { name: string; sequence: number; total: number; done: number; inProgress: number; pending: number; percent: number; }
export interface ProjectProgress {
  nodes: { total: number; group: number; assembly: number; subassembly: number; part: number };
  status: Record<PStatus, number>;
  percentComplete: number;
  tonnage: { totalKg: number; processedKg: number; shippedKg: number };
  stages: StageBucket[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function computeProgress(nodes: PNode[], stageRows: PStageRow[]): ProjectProgress {
  const nodeCounts = { total: nodes.length, group: 0, assembly: 0, subassembly: 0, part: 0 };
  const status: Record<PStatus, number> = { not_started: 0, in_progress: 0, ready_to_ship: 0, shipped: 0, on_hold: 0 };
  let totalKg = 0;
  let processedKg = 0;
  let shippedKg = 0;
  let fabCount = 0;
  let fabPctSum = 0;

  for (const n of nodes) {
    nodeCounts[n.nodeType]++;
    if (n.nodeType === 'assembly' || n.nodeType === 'subassembly') {
      if (status[n.productionStatus] != null) status[n.productionStatus]++;
      fabCount++;
      fabPctSum += n.percentComplete;
    }
    if (n.nodeType === 'part') {
      const w = (n.weightKg || 0) * (n.quantity || 1);
      totalKg += w;
      processedKg += (w * (n.percentComplete || 0)) / 100;
      if (n.productionStatus === 'shipped') shippedKg += w;
    }
  }

  // Weight-weighted when part weights exist; otherwise fall back to the average
  // assembly progress (e.g. IFCs that don't carry weights).
  const percentComplete = totalKg > 0 ? r1((processedKg / totalKg) * 100) : fabCount > 0 ? r1(fabPctSum / fabCount) : 0;

  const byStage = new Map<string, StageBucket>();
  for (const s of stageRows) {
    const key = `${s.sequence}|${s.name}`;
    const e = byStage.get(key) ?? { name: s.name, sequence: s.sequence, total: 0, done: 0, inProgress: 0, pending: 0, percent: 0 };
    e.total++;
    if (s.status === 'completed' || s.status === 'skipped') e.done++;
    else if (s.status === 'in_progress') e.inProgress++;
    else e.pending++;
    byStage.set(key, e);
  }
  const stages = [...byStage.values()]
    .sort((a, b) => a.sequence - b.sequence)
    .map((s) => ({ ...s, percent: s.total ? Math.round((s.done / s.total) * 100) : 0 }));

  return {
    nodes: nodeCounts,
    status,
    percentComplete,
    tonnage: { totalKg: r1(totalKg), processedKg: r1(processedKg), shippedKg: r1(shippedKg) },
    stages,
  };
}
