import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Project } from './project.entity.js';
import { AssemblyNode, NodeProductionStatus } from './assembly-node.entity.js';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { WorkOrderStage } from '../work-orders/work-order-stage.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { aggregateStatus, aggregateTree, leafFromStages, Rollup, StageStatus } from './rollup-math.js';

@Injectable()
export class StatusRollupService {
  constructor(
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    @InjectRepository(AssemblyNode) private readonly nodeRepo: Repository<AssemblyNode>,
    @InjectRepository(WorkOrder) private readonly woRepo: Repository<WorkOrder>,
    @InjectRepository(WorkOrderStage) private readonly wosRepo: Repository<WorkOrderStage>,
  ) {}

  /**
   * Resolve the project that a work order's assembly node belongs to and
   * recompute it. Called automatically when a work-order stage changes.
   * No-ops for product (non-fabrication) work orders.
   */
  async recomputeForWorkOrder(workOrderId: string): Promise<void> {
    const organizationId = TenantContext.requireOrganizationId();
    const wo = await this.woRepo.findOne({ where: { id: workOrderId, organizationId } });
    if (!wo || !wo.assemblyNodeId) return;
    const node = await this.nodeRepo.findOne({ where: { id: wo.assemblyNodeId, organizationId } });
    if (!node) return;
    await this.recomputeProject(node.projectId);
  }

  /** Recompute every node's status/percent from its work-order stages and roll up the tree. */
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
