import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Project } from './project.entity.js';
import { AssemblyNode, AssemblyNodeType, NodeProductionStatus } from './assembly-node.entity.js';
import { WorkOrder, WorkOrderStatus } from '../work-orders/work-order.entity.js';
import { WorkOrderStage, WorkOrderStageStatus } from '../work-orders/work-order-stage.entity.js';
import { Stage } from '../stages/stage.entity.js';
import { Product } from '../products/product.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';

@Injectable()
export class WorkOrderGenService {
  constructor(
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    @InjectRepository(AssemblyNode) private readonly nodeRepo: Repository<AssemblyNode>,
    @InjectRepository(WorkOrder) private readonly woRepo: Repository<WorkOrder>,
    @InjectRepository(WorkOrderStage) private readonly wosRepo: Repository<WorkOrderStage>,
    @InjectRepository(Stage) private readonly stageRepo: Repository<Stage>,
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
  ) {}

  /**
   * Generate a WorkOrder for every fabricated assembly/subassembly node in the
   * project against the chosen process, materializing its WorkOrderStages.
   * Idempotent: a node that already has a work order is skipped.
   */
  async generate(projectId: string, processId: string): Promise<{ created: number; skipped: number }> {
    const organizationId = TenantContext.requireOrganizationId();
    const project = await this.projectRepo.findOne({ where: { id: projectId, organizationId } });
    if (!project) throw new NotFoundException('Project not found');

    const stages = await this.stageRepo.find({ where: { processId, organizationId }, order: { sequence: 'ASC' } });
    if (!stages.length) throw new BadRequestException('Chosen process has no stages (or is not in this organization)');

    // Attach the chosen process to the project so its stage pipeline shows in the app.
    if (project.processId !== processId) { project.processId = processId; await this.projectRepo.save(project); }

    // Work orders require a product; one stand-in product represents the project.
    let product = await this.productRepo.findOne({ where: { organizationId, name: project.name } });
    if (!product) {
      product = await this.productRepo.save(this.productRepo.create({
        name: project.name,
        description: `Fabrication project ${project.projectNumber ?? ''}`.trim(),
        organizationId,
      }));
    }

    const nodes = await this.nodeRepo.find({
      where: { organizationId, projectId, nodeType: In([AssemblyNodeType.ASSEMBLY, AssemblyNodeType.SUBASSEMBLY]) },
      order: { depth: 'ASC', sortIndex: 'ASC' },
    });

    let created = 0;
    let skipped = 0;
    for (const node of nodes) {
      const existing = await this.woRepo.findOne({ where: { organizationId, assemblyNodeId: node.id } });
      if (existing) { skipped++; continue; }

      const wo = await this.saveWithOrderNumber(organizationId, product.id, processId, node);
      for (const st of stages) {
        await this.wosRepo.save(this.wosRepo.create({
          workOrderId: wo.id, stageId: st.id, status: WorkOrderStageStatus.PENDING, organizationId,
        }));
      }
      node.currentStageId = stages[0].id;
      node.productionStatus = NodeProductionStatus.NOT_STARTED;
      node.percentComplete = 0;
      await this.nodeRepo.save(node);
      created++;
    }
    return { created, skipped };
  }

  private async saveWithOrderNumber(organizationId: string, productId: string, processId: string, node: AssemblyNode): Promise<WorkOrder> {
    const year = new Date().getFullYear();
    for (let attempt = 0; attempt < 5; attempt++) {
      const count = await this.woRepo.count();
      const orderNumber = `WO-${year}-${String(count + 1).padStart(4, '0')}`;
      try {
        return await this.woRepo.save(this.woRepo.create({
          orderNumber, productId, processId, assemblyNodeId: node.id,
          quantity: node.quantity ?? 1, status: WorkOrderStatus.PENDING, organizationId,
        }));
      } catch (e: any) {
        if (e?.code === '23505') continue; // unique orderNumber race — retry
        throw e;
      }
    }
    throw new BadRequestException('Could not allocate a unique work-order number');
  }
}
