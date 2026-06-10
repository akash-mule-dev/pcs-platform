import { Injectable, NotFoundException, BadRequestException, forwardRef, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Not } from 'typeorm';
import { WorkOrder, WorkOrderStatus } from './work-order.entity.js';
import { WorkOrderStage, WorkOrderStageStatus } from './work-order-stage.entity.js';
import { Stage } from '../stages/stage.entity.js';
import { Ncr, NcrStatus } from '../quality-ncr/entities/ncr.entity.js';
import { isQualityStageName, qcGateMessage } from './qc-gate.js';
import { CreateWorkOrderDto } from './dto/create-work-order.dto.js';
import { UpdateWorkOrderDto } from './dto/update-work-order.dto.js';
import { AssignWorkOrderDto } from './dto/assign-work-order.dto.js';
import { PageOptionsDto, PageDto, PageMetaDto } from '../common/dto/pagination.dto.js';
import { AuditService } from '../audit/audit.service.js';
import { EventsGateway } from '../websocket/events.gateway.js';
import { InventoryService } from '../materials/inventory.service.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { StatusRollupService } from '../projects/status-rollup.service.js';

@Injectable()
export class WorkOrdersService {
  constructor(
    @InjectRepository(WorkOrder) private readonly woRepo: Repository<WorkOrder>,
    @InjectRepository(WorkOrderStage) private readonly wosRepo: Repository<WorkOrderStage>,
    @InjectRepository(Stage) private readonly stageRepo: Repository<Stage>,
    @InjectRepository(Ncr) private readonly ncrRepo: Repository<Ncr>,
    private readonly auditService: AuditService,
    private readonly eventsGateway: EventsGateway,
    private readonly inventoryService: InventoryService,
    @Inject(forwardRef(() => StatusRollupService)) private readonly rollup: StatusRollupService,
  ) {}

  /** Best-effort: refresh the assembly/project status roll-up after a work-order stage change. */
  private async recomputeRollup(workOrderId: string): Promise<void> {
    try { await this.rollup.recomputeForWorkOrder(workOrderId); } catch { /* non-fatal */ }
  }

  /** Open NCRs linked to a fabricated assembly (anything not closed/cancelled blocks the quality gate). */
  private countOpenNcrs(assemblyNodeId: string): Promise<number> {
    return this.ncrRepo.count({
      where: {
        assemblyNodeId,
        status: Not(In([NcrStatus.CLOSED, NcrStatus.CANCELLED])),
        organizationId: TenantContext.getOrganizationId() ?? undefined,
      },
    });
  }

  /**
   * Quality gate: a quality stage of a fabrication work order cannot be
   * completed while the assembly still has open NCRs. Throws 400 when blocked.
   */
  private async assertQualityGate(wo: WorkOrder | null, stageName: string | null | undefined): Promise<void> {
    if (!wo?.assemblyNodeId || !isQualityStageName(stageName)) return;
    const open = await this.countOpenNcrs(wo.assemblyNodeId);
    if (open > 0) throw new BadRequestException(qcGateMessage(wo.orderNumber, open));
  }

  async findAll(pageOptions: PageOptionsDto, status?: string, priority?: string): Promise<PageDto<WorkOrder>> {
    const qb = this.woRepo.createQueryBuilder('wo')
      .leftJoinAndSelect('wo.product', 'product')
      .leftJoinAndSelect('wo.process', 'process')
      .leftJoinAndSelect('wo.line', 'line')
      .orderBy('wo.createdAt', pageOptions.order)
      .skip(pageOptions.skip)
      .take(pageOptions.limit);

    if (status) qb.andWhere('wo.status = :status', { status });
    if (priority) qb.andWhere('wo.priority = :priority', { priority });
    const org = TenantContext.getOrganizationId();
    if (org) qb.andWhere('wo.organization_id = :org', { org });

    const [items, count] = await qb.getManyAndCount();
    return new PageDto(items, new PageMetaDto(pageOptions, count));
  }

  async findOne(id: string): Promise<WorkOrder> {
    const wo = await this.woRepo.findOne({
      where: { id, organizationId: TenantContext.getOrganizationId() ?? undefined },
      relations: ['product', 'process', 'line', 'stages', 'stages.stage', 'stages.assignedUser', 'stages.station'],
    });
    if (!wo) throw new NotFoundException('Work order not found');
    return wo;
  }

  async create(dto: CreateWorkOrderDto): Promise<WorkOrder> {
    const year = new Date().getFullYear();

    // Retry loop handles concurrent duplicate orderNumber race condition
    let saved: WorkOrder | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      const count = await this.woRepo.count();
      const orderNumber = `WO-${year}-${String(count + 1).padStart(4, '0')}`;

      try {
        const wo = this.woRepo.create({
          orderNumber,
          productId: dto.productId,
          processId: dto.processId,
          lineId: dto.lineId || null,
          quantity: dto.quantity,
          priority: dto.priority,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        });
        saved = await this.woRepo.save(wo);
        break;
      } catch (error: any) {
        // 23505 = PostgreSQL unique_violation — another request used the same orderNumber
        if (error.code === '23505' && attempt < 4) continue;
        throw error;
      }
    }

    // Auto-create work order stages from process stages
    const stages = await this.stageRepo.find({ where: { processId: dto.processId }, order: { sequence: 'ASC' } });
    for (const stage of stages) {
      const wos = this.wosRepo.create({ workOrderId: saved!.id, stageId: stage.id });
      await this.wosRepo.save(wos);
    }

    const created = await this.findOne(saved!.id);
    this.eventsGateway.emitWorkOrderUpdate(created);
    this.eventsGateway.emitDashboardRefresh();
    return created;
  }

  async update(id: string, dto: UpdateWorkOrderDto): Promise<WorkOrder> {
    const wo = await this.findOne(id);
    if (dto.lineId !== undefined) wo.lineId = dto.lineId;
    if (dto.quantity !== undefined) wo.quantity = dto.quantity;
    if (dto.priority !== undefined) wo.priority = dto.priority;
    if (dto.dueDate !== undefined) wo.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    await this.woRepo.save(wo);
    const updated = await this.findOne(id);
    this.eventsGateway.emitWorkOrderUpdate(updated);
    return updated;
  }

  async updateStatus(id: string, newStatus: WorkOrderStatus): Promise<WorkOrder> {
    const wo = await this.findOne(id);
    const validTransitions: Record<string, string[]> = {
      draft: ['pending', 'cancelled'],
      pending: ['in_progress', 'cancelled'],
      in_progress: ['completed', 'cancelled'],
      completed: ['cancelled'],
      cancelled: [],
    };
    if (!validTransitions[wo.status]?.includes(newStatus)) {
      throw new BadRequestException(`Cannot transition from ${wo.status} to ${newStatus}`);
    }
    // Phase 7: Check dependency is completed before starting
    if (newStatus === WorkOrderStatus.IN_PROGRESS && wo.dependsOnId) {
      const dep = await this.woRepo.findOne({ where: { id: wo.dependsOnId } });
      if (dep && dep.status !== WorkOrderStatus.COMPLETED) {
        throw new BadRequestException(`Cannot start: depends on ${dep.orderNumber} which is not completed`);
      }
    }

    // Phase 2: Block starting a job we don't have the materials for.
    // (Only enforced when the product has a BOM; soft-passes otherwise.)
    if (newStatus === WorkOrderStatus.IN_PROGRESS) {
      const availability = await this.inventoryService.checkAvailability(wo.productId, wo.quantity);
      if (availability.hasBom && !availability.canRelease) {
        throw new BadRequestException({
          message: 'Cannot start work order: insufficient materials in stock',
          shortages: availability.shortages,
        });
      }
    }

    // Quality gate: completing the whole WO cascades every stage (incl. quality)
    // to completed — blocked while the fabricated assembly has open NCRs.
    if (newStatus === WorkOrderStatus.COMPLETED && wo.assemblyNodeId) {
      const open = await this.countOpenNcrs(wo.assemblyNodeId);
      if (open > 0) throw new BadRequestException(qcGateMessage(wo.orderNumber, open));
    }

    const oldStatus = wo.status;
    wo.status = newStatus;
    const now = new Date();
    if (newStatus === WorkOrderStatus.IN_PROGRESS) wo.startedAt = now;
    if (newStatus === WorkOrderStatus.COMPLETED) wo.completedAt = now;
    await this.woRepo.save(wo);

    // Cascade status to stages
    if (newStatus === WorkOrderStatus.COMPLETED) {
      const stages = await this.wosRepo.find({ where: { workOrderId: id } });
      for (const stage of stages) {
        if (stage.status !== WorkOrderStageStatus.COMPLETED && stage.status !== WorkOrderStageStatus.SKIPPED) {
          stage.status = WorkOrderStageStatus.COMPLETED;
          stage.completedAt = stage.completedAt || now;
          await this.wosRepo.save(stage);
        }
      }
    } else if (newStatus === WorkOrderStatus.CANCELLED) {
      const stages = await this.wosRepo.find({ where: { workOrderId: id } });
      for (const stage of stages) {
        if (stage.status === WorkOrderStageStatus.IN_PROGRESS) {
          stage.status = WorkOrderStageStatus.PENDING;
          await this.wosRepo.save(stage);
        }
      }
    }

    // Phase 12: Audit log
    await this.auditService.log({
      action: 'status_change',
      entityType: 'work_order',
      entityId: id,
      oldValues: { status: oldStatus },
      newValues: { status: newStatus },
    });

    await this.recomputeRollup(id);
    const updated = await this.findOne(id);
    this.eventsGateway.emitWorkOrderUpdate(updated);
    this.eventsGateway.emitDashboardRefresh();
    return updated;
  }

  // Phase 7: Batch status update
  async batchUpdateStatus(ids: string[], newStatus: WorkOrderStatus): Promise<{ updated: number; errors: string[] }> {
    const errors: string[] = [];
    let updated = 0;
    for (const id of ids) {
      try {
        await this.updateStatus(id, newStatus);
        updated++;
      } catch (e: any) {
        errors.push(`${id}: ${e.message}`);
      }
    }
    return { updated, errors };
  }

  // Phase 7: Batch assign to line
  async batchAssignLine(ids: string[], lineId: string): Promise<number> {
    const result = await this.woRepo.update({ id: In(ids) }, { lineId });
    this.eventsGateway.emitWorkOrderUpdate({ ids, lineId });
    return result.affected || 0;
  }

  async updateStageStatus(workOrderId: string, stageId: string, newStatus: WorkOrderStageStatus): Promise<WorkOrder> {
    const wos = await this.wosRepo.findOne({ where: { id: stageId, workOrderId }, relations: ['stage'] });
    if (!wos) throw new NotFoundException('Work order stage not found');

    // Quality gate: a quality stage can't be completed while the assembly has open NCRs.
    if (newStatus === WorkOrderStageStatus.COMPLETED && wos.status !== WorkOrderStageStatus.COMPLETED) {
      const wo = await this.woRepo.findOne({ where: { id: workOrderId } });
      await this.assertQualityGate(wo, wos.stage?.name);
    }

    const now = new Date();
    wos.status = newStatus;
    if (newStatus === WorkOrderStageStatus.IN_PROGRESS && !wos.startedAt) {
      wos.startedAt = now;
    }
    if (newStatus === WorkOrderStageStatus.COMPLETED) {
      wos.completedAt = now;
      if (wos.startedAt) {
        wos.actualTimeSeconds = Math.round((now.getTime() - new Date(wos.startedAt).getTime()) / 1000);
      }
    }
    if (newStatus === WorkOrderStageStatus.PENDING) {
      wos.startedAt = null;
      wos.completedAt = null;
      wos.actualTimeSeconds = null;
    }
    await this.wosRepo.save(wos);

    await this.auditService.log({
      action: 'stage_status_change',
      entityType: 'work_order_stage',
      entityId: stageId,
      oldValues: {},
      newValues: { status: newStatus },
    });

    await this.recomputeRollup(workOrderId);
    const updated = await this.findOne(workOrderId);
    this.eventsGateway.emitWorkOrderUpdate(updated);
    return updated;
  }

  async assign(id: string, dto: AssignWorkOrderDto): Promise<WorkOrder> {
    for (const assignment of dto.assignments) {
      const wos = await this.wosRepo.findOne({ where: { workOrderId: id, stageId: assignment.stageId } });
      if (!wos) throw new NotFoundException(`Work order stage not found for stageId ${assignment.stageId}`);
      wos.assignedUserId = assignment.userId;
      if (assignment.stationId) wos.stationId = assignment.stationId;
      await this.wosRepo.save(wos);
    }
    const updated = await this.findOne(id);
    this.eventsGateway.emitWorkOrderUpdate(updated);
    return updated;
  }
}
