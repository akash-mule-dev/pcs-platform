import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Project } from './project.entity.js';
import { AssemblyNode } from './assembly-node.entity.js';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { computeProgress, ProjectProgress, PType } from './progress-math.js';

/**
 * Design summary for the workspace header / overview: what the project IS
 * (composition + tonnage) plus how many work-order items exist across its
 * production orders. Per-order progress lives at /orders/:id/progress.
 */
@Injectable()
export class ProjectProgressService {
  constructor(
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    @InjectRepository(AssemblyNode) private readonly nodeRepo: Repository<AssemblyNode>,
    @InjectRepository(WorkOrder) private readonly woRepo: Repository<WorkOrder>,
  ) {}

  async getProgress(projectId: string): Promise<ProjectProgress & { workOrders: number }> {
    const organizationId = TenantContext.requireOrganizationId();
    const project = await this.projectRepo.findOne({ where: { id: projectId, organizationId } });
    if (!project) throw new NotFoundException('Project not found');

    const nodes = await this.nodeRepo.find({ where: { organizationId, projectId } });
    const workOrders = nodes.length
      ? await this.woRepo.count({ where: { organizationId, assemblyNodeId: In(nodes.map((n) => n.id)) } })
      : 0;

    const progress = computeProgress(
      nodes.map((n) => ({
        nodeType: n.nodeType as PType,
        weightKg: n.weightKg != null ? Number(n.weightKg) : null,
        quantity: n.quantity ?? 1,
      })),
    );
    return { ...progress, workOrders };
  }
}
