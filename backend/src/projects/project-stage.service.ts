import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Project } from './project.entity.js';
import { AssemblyNode } from './assembly-node.entity.js';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { WorkOrderStage, WorkOrderStageStatus } from '../work-orders/work-order-stage.entity.js';
import { Stage } from '../stages/stage.entity.js';
import { WorkOrdersService } from '../work-orders/work-orders.service.js';
import { TenantContext } from '../common/tenant/tenant-context.js';

export interface NodeStageRow { id: string | null; stageId: string; name: string; sequence: number; status: string }
export interface StageBoardStageRow { stageId: string; workOrderStageId: string; status: string; sequence: number }
export interface StageBoardItem { nodeId: string; mark: string; nodeType: string; productionStatus: string; percentComplete: number; stages: StageBoardStageRow[] }
export interface StageBoard { stages: { id: string; name: string; sequence: number; targetTimeSeconds: number }[]; items: StageBoardItem[] }

@Injectable()
export class ProjectStageService {
  constructor(
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    @InjectRepository(AssemblyNode) private readonly nodeRepo: Repository<AssemblyNode>,
    @InjectRepository(WorkOrder) private readonly woRepo: Repository<WorkOrder>,
    @InjectRepository(WorkOrderStage) private readonly wosRepo: Repository<WorkOrderStage>,
    @InjectRepository(Stage) private readonly stageRepo: Repository<Stage>,
    @Inject(forwardRef(() => WorkOrdersService)) private readonly workOrders: WorkOrdersService,
  ) {}

  /** The stage pipeline of the process attached to the project (empty if none attached). */
  async getProjectStages(projectId: string): Promise<{ id: string; name: string; sequence: number; targetTimeSeconds: number }[]> {
    const organizationId = TenantContext.requireOrganizationId();
    const project = await this.projectRepo.findOne({ where: { id: projectId, organizationId } });
    if (!project) throw new NotFoundException('Project not found');
    if (!project.processId) return [];
    const stages = await this.stageRepo.find({ where: { processId: project.processId, organizationId }, order: { sequence: 'ASC' } });
    return stages.map((s) => ({ id: s.id, name: s.name, sequence: s.sequence, targetTimeSeconds: s.targetTimeSeconds }));
  }

  /** A node's per-stage status (from its work order); falls back to the project pipeline if no WO yet. */
  async getNodeStages(projectId: string, nodeId: string): Promise<{ workOrderId: string | null; nodeStatus: string; percentComplete: number; stages: NodeStageRow[] }> {
    const organizationId = TenantContext.requireOrganizationId();
    const node = await this.nodeRepo.findOne({ where: { id: nodeId, projectId, organizationId } });
    if (!node) throw new NotFoundException('Assembly not found');

    const wo = await this.woRepo.findOne({ where: { organizationId, assemblyNodeId: nodeId } });
    if (wo) {
      const rows = await this.wosRepo.find({ where: { workOrderId: wo.id } });
      const stages: NodeStageRow[] = rows
        .map((r) => ({ id: r.id, stageId: r.stageId, name: r.stage?.name ?? 'Stage', sequence: r.stage?.sequence ?? 0, status: r.status as string }))
        .sort((a, b) => a.sequence - b.sequence);
      return { workOrderId: wo.id, nodeStatus: node.productionStatus, percentComplete: Number(node.percentComplete) || 0, stages };
    }

    const pipeline = await this.getProjectStages(projectId);
    return {
      workOrderId: null,
      nodeStatus: node.productionStatus,
      percentComplete: Number(node.percentComplete) || 0,
      stages: pipeline.map((s) => ({ id: null, stageId: s.id, name: s.name, sequence: s.sequence, status: 'pending' })),
    };
  }

  /**
   * Kanban board data: the project's stage pipeline + every work-order item
   * (assembly/subassembly) with its INDEPENDENT per-stage statuses. The client
   * places each item in the column of its active stage and can move it to any
   * stage (statuses are independent — no forced sequence).
   */
  async getStageBoard(projectId: string): Promise<StageBoard> {
    const organizationId = TenantContext.requireOrganizationId();
    const project = await this.projectRepo.findOne({ where: { id: projectId, organizationId } });
    if (!project) throw new NotFoundException('Project not found');
    const stages = await this.getProjectStages(projectId);
    const nodes = await this.nodeRepo.find({ where: { projectId, organizationId } });
    const woNodeIds = nodes.filter((n) => { const t = String(n.nodeType); return t === 'assembly' || t === 'subassembly'; }).map((n) => n.id);
    if (!woNodeIds.length) return { stages, items: [] };
    const wos = await this.woRepo.find({ where: { organizationId, assemblyNodeId: In(woNodeIds) } });
    if (!wos.length) return { stages, items: [] };
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const woById = new Map(wos.map((w) => [w.id, w]));
    const rows = await this.wosRepo.find({ where: { workOrderId: In(wos.map((w) => w.id)) }, relations: ['stage'] });
    const byNode = new Map<string, StageBoardItem>();
    for (const r of rows) {
      const wo = woById.get(r.workOrderId);
      const node = wo?.assemblyNodeId ? nodeById.get(wo.assemblyNodeId) : undefined;
      if (!node) continue;
      let it = byNode.get(node.id);
      if (!it) {
        it = {
          nodeId: node.id,
          mark: node.mark || node.name,
          nodeType: String(node.nodeType),
          productionStatus: String(node.productionStatus),
          percentComplete: Number(node.percentComplete) || 0,
          stages: [],
        };
        byNode.set(node.id, it);
      }
      it.stages.push({ stageId: r.stageId, workOrderStageId: r.id, status: String(r.status), sequence: r.stage?.sequence ?? 0 });
    }
    const items = [...byNode.values()];
    for (const it of items) it.stages.sort((a, b) => a.sequence - b.sequence);
    return { stages, items };
  }

  /** Set a node's work-order stage status. Delegates to WorkOrdersService → live roll-up + audit + websocket. */
  async setNodeStageStatus(projectId: string, nodeId: string, workOrderStageId: string, status: string): Promise<{ ok: true }> {
    const organizationId = TenantContext.requireOrganizationId();
    const node = await this.nodeRepo.findOne({ where: { id: nodeId, projectId, organizationId } });
    if (!node) throw new NotFoundException('Assembly not found');
    const wo = await this.woRepo.findOne({ where: { organizationId, assemblyNodeId: nodeId } });
    if (!wo) throw new BadRequestException('No work order for this assembly yet — generate work orders first');
    await this.workOrders.updateStageStatus(wo.id, workOrderStageId, status as WorkOrderStageStatus);
    return { ok: true };
  }
}
