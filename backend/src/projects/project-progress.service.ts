import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Project } from './project.entity.js';
import { AssemblyNode } from './assembly-node.entity.js';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { WorkOrderStage } from '../work-orders/work-order-stage.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { computeProgress, ProjectProgress, PType, PStatus, SStatus } from './progress-math.js';

@Injectable()
export class ProjectProgressService {
  constructor(
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    @InjectRepository(AssemblyNode) private readonly nodeRepo: Repository<AssemblyNode>,
    @InjectRepository(WorkOrder) private readonly woRepo: Repository<WorkOrder>,
    @InjectRepository(WorkOrderStage) private readonly wosRepo: Repository<WorkOrderStage>,
  ) {}

  async getProgress(projectId: string): Promise<ProjectProgress & { workOrders: number }> {
    const organizationId = TenantContext.requireOrganizationId();
    const project = await this.projectRepo.findOne({ where: { id: projectId, organizationId } });
    if (!project) throw new NotFoundException('Project not found');

    const nodes = await this.nodeRepo.find({ where: { organizationId, projectId } });
    const wos = nodes.length
      ? await this.woRepo.find({ where: { organizationId, assemblyNodeId: In(nodes.map((n) => n.id)) } })
      : [];
    const woIds = wos.map((w) => w.id);
    const stageRows = woIds.length ? await this.wosRepo.find({ where: { workOrderId: In(woIds) } }) : [];

    const progress = computeProgress(
      nodes.map((n) => ({
        nodeType: n.nodeType as PType,
        productionStatus: n.productionStatus as PStatus,
        percentComplete: Number(n.percentComplete) || 0,
        weightKg: n.weightKg != null ? Number(n.weightKg) : null,
        quantity: n.quantity ?? 1,
      })),
      stageRows.map((s) => ({ name: s.stage?.name ?? 'Stage', sequence: s.stage?.sequence ?? 0, status: s.status as unknown as SStatus })),
    );
    return { ...progress, workOrders: wos.length };
  }
}
