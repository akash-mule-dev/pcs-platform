import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Project } from './project.entity.js';
import { AssemblyNode, NodeProductionStatus } from './assembly-node.entity.js';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { WorkOrderStage } from '../work-orders/work-order-stage.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { aggregateStatus, aggregateTree, branchRollup, leafFromStages, ProdStatus, Rollup, StageStatus } from './rollup-math.js';

@Injectable()
export class StatusRollupService {
  constructor(
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    @InjectRepository(AssemblyNode) private readonly nodeRepo: Repository<AssemblyNode>,
    @InjectRepository(WorkOrder) private readonly woRepo: Repository<WorkOrder>,
    @InjectRepository(WorkOrderStage) private readonly wosRepo: Repository<WorkOrderStage>,
  ) {}

  /**
   * Called automatically when a work-order stage changes. Recomputes only the
   * AFFECTED BRANCH (the work order's node, its inheriting part-descendants, and
   * its ancestor chain) rather than the whole project. No-ops for product WOs.
   */
  async recomputeForWorkOrder(workOrderId: string): Promise<void> {
    const organizationId = TenantContext.requireOrganizationId();
    const wo = await this.woRepo.findOne({ where: { id: workOrderId, organizationId } });
    if (!wo || !wo.assemblyNodeId) return;
    await this.recomputeBranchForNode(wo.assemblyNodeId, organizationId);
  }

  /** Recompute one node from its stages, push to inheriting descendants, and re-roll its ancestors. */
  async recomputeBranchForNode(nodeId: string, organizationId = TenantContext.requireOrganizationId()): Promise<void> {
    const node = await this.nodeRepo.findOne({ where: { id: nodeId, organizationId } });
    if (!node) return;
    const wo = await this.woRepo.findOne({ where: { organizationId, assemblyNodeId: nodeId } });
    if (!wo) return;

    const stageRows = await this.wosRepo.find({ where: { workOrderId: wo.id } });
    const changedLeaf = leafFromStages(
      stageRows.map((srow) => ({ status: srow.status as unknown as StageStatus, stageId: srow.stageId, sequence: srow.stage?.sequence })),
      node.qtyShipped ?? 0,
      node.quantity ?? 1,
    );

    // Gather the affected branch: descendants (+ which carry their own WO) and the ancestor chain.
    const subtree = await this.loadSubtree(organizationId, nodeId);
    const descendants = subtree.map((n) => ({ id: n.id, parentId: n.parentId as string }));
    const woNodeIds = new Set(
      (await this.woRepo.find({ where: { organizationId, assemblyNodeId: In(subtree.map((n) => n.id).concat(nodeId)) } }))
        .map((w) => w.assemblyNodeId as string),
    );

    const ancestors: { id: string; hasWo: boolean; childIds: string[] }[] = [];
    const current = new Map<string, Rollup>();
    let parentId = node.parentId;
    while (parentId) {
      const anc = await this.nodeRepo.findOne({ where: { id: parentId, organizationId } });
      if (!anc) break;
      const ancWo = await this.woRepo.findOne({ where: { organizationId, assemblyNodeId: anc.id } });
      const kids = await this.nodeRepo.find({ where: { organizationId, parentId: anc.id } });
      for (const k of kids) {
        current.set(k.id, { status: k.productionStatus as unknown as ProdStatus, percentComplete: Number(k.percentComplete), currentStageId: k.currentStageId ?? null });
      }
      ancestors.push({ id: anc.id, hasWo: !!ancWo, childIds: kids.map((k) => k.id) });
      parentId = anc.parentId;
    }

    const updates = branchRollup({ changedNodeId: nodeId, changedLeaf, descendants, woNodeIds, ancestors, current });

    // Persist only the changed branch nodes.
    const entities = await this.nodeRepo.find({ where: { id: In([...updates.keys()]), organizationId } });
    for (const e of entities) {
      const r = updates.get(e.id);
      if (r) await this.applyIfChanged(e, r.status, r.percentComplete, r.currentStageId);
    }
  }

  private async applyIfChanged(node: AssemblyNode, status: ProdStatus, percent: number, currentStageId: string | null): Promise<void> {
    const st = status as unknown as NodeProductionStatus;
    if (node.productionStatus !== st || Number(node.percentComplete) !== percent || (node.currentStageId ?? null) !== (currentStageId ?? null)) {
      node.productionStatus = st;
      node.percentComplete = percent;
      node.currentStageId = currentStageId ?? null;
      await this.nodeRepo.save(node);
    }
  }

  /** All descendants of a node (BFS by parent_id). */
  private async loadSubtree(organizationId: string, rootId: string): Promise<AssemblyNode[]> {
    const all: AssemblyNode[] = [];
    let frontier = [rootId];
    while (frontier.length) {
      const kids = await this.nodeRepo.find({ where: { organizationId, parentId: In(frontier) } });
      if (!kids.length) break;
      all.push(...kids);
      frontier = kids.map((k) => k.id);
    }
    return all;
  }

  /** Full-project recompute (manual "Refresh status" / after import or generation). */
  async recomputeProject(projectId: string): Promise<{ updated: number; projectStatus: string | null }> {
    const organizationId = TenantContext.requireOrganizationId();
    const project = await this.projectRepo.findOne({ where: { id: projectId, organizationId } });
    if (!project) throw new NotFoundException('Project not found');

    const nodes = await this.nodeRepo.find({ where: { organizationId, projectId } });
    if (!nodes.length) return { updated: 0, projectStatus: null };

    const wos = await this.woRepo.find({ where: { organizationId, assemblyNodeId: In(nodes.map((n) => n.id)) } });
    const woByNode = new Map<string, WorkOrder>();
    for (const w of wos) if (w.assemblyNodeId) woByNode.set(w.assemblyNodeId, w);
    const woIds = wos.map((w) => w.id);
    const stageRows = woIds.length ? await this.wosRepo.find({ where: { workOrderId: In(woIds) } }) : [];
    const stagesByWo = new Map<string, WorkOrderStage[]>();
    for (const s of stageRows) { const a = stagesByWo.get(s.workOrderId) ?? []; a.push(s); stagesByWo.set(s.workOrderId, a); }

    const leaf = new Map<string, Rollup>();
    for (const node of nodes) {
      const wo = woByNode.get(node.id);
      if (!wo) continue;
      const stages = (stagesByWo.get(wo.id) ?? []).map((s) => ({
        status: s.status as unknown as StageStatus,
        stageId: s.stageId,
        sequence: s.stage?.sequence,
      }));
      leaf.set(node.id, leafFromStages(stages, node.qtyShipped ?? 0, node.quantity ?? 1));
    }

    const computed = aggregateTree(nodes.map((n) => ({ id: n.id, parentId: n.parentId, depth: n.depth })), leaf);

    let updated = 0;
    for (const node of nodes) {
      const r = computed.get(node.id);
      if (!r) continue;
      const newStatus = r.status as unknown as NodeProductionStatus;
      if (node.productionStatus !== newStatus || Number(node.percentComplete) !== r.percentComplete || (node.currentStageId ?? null) !== r.currentStageId) {
        node.productionStatus = newStatus;
        node.percentComplete = r.percentComplete;
        node.currentStageId = r.currentStageId;
        await this.nodeRepo.save(node);
        updated++;
      }
    }

    const rootStatuses = nodes.filter((n) => !n.parentId).map((n) => computed.get(n.id)?.status).filter(Boolean) as any[];
    return { updated, projectStatus: aggregateStatus(rootStatuses) };
  }
}
