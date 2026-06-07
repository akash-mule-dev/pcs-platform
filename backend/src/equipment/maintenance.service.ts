import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual } from 'typeorm';
import { MaintenancePlan } from './entities/maintenance-plan.entity.js';
import { MaintenanceOrder, MaintenanceOrderStatus } from './entities/maintenance-order.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import {
  CreateMaintenancePlanDto, UpdateMaintenancePlanDto,
  CreateMaintenanceOrderDto, UpdateMaintenanceOrderDto,
} from './dto/maintenance.dto.js';

const DAY_MS = 24 * 3600 * 1000;

@Injectable()
export class MaintenanceService {
  constructor(
    @InjectRepository(MaintenancePlan) private readonly planRepo: Repository<MaintenancePlan>,
    @InjectRepository(MaintenanceOrder) private readonly orderRepo: Repository<MaintenanceOrder>,
  ) {}

  private get org(): string { return TenantContext.requireOrganizationId(); }

  // ---- Plans ----
  listPlans(): Promise<MaintenancePlan[]> {
    return this.planRepo.find({ where: { organizationId: this.org } as any });
  }
  createPlan(dto: CreateMaintenancePlanDto): Promise<MaintenancePlan> {
    const nextDueAt = new Date(Date.now() + dto.intervalDays * DAY_MS);
    const plan = this.planRepo.create({ ...(dto as any), organizationId: this.org, nextDueAt });
    return this.planRepo.save(plan as any);
  }
  async updatePlan(id: string, dto: UpdateMaintenancePlanDto): Promise<MaintenancePlan> {
    const plan = await this.planRepo.findOne({ where: { id, organizationId: this.org } as any });
    if (!plan) throw new NotFoundException('Maintenance plan not found');
    Object.assign(plan, dto);
    return this.planRepo.save(plan);
  }
  async removePlan(id: string): Promise<void> {
    const plan = await this.planRepo.findOne({ where: { id, organizationId: this.org } as any });
    if (!plan) throw new NotFoundException('Maintenance plan not found');
    await this.planRepo.remove(plan);
  }
  /** Plans whose next service is due. */
  due(): Promise<MaintenancePlan[]> {
    return this.planRepo.find({
      where: { organizationId: this.org, isActive: true, nextDueAt: LessThanOrEqual(new Date()) } as any,
      order: { nextDueAt: 'ASC' } as any,
    });
  }

  // ---- Orders ----
  listOrders(status?: string): Promise<MaintenanceOrder[]> {
    const where: any = { organizationId: this.org };
    if (status) where.status = status;
    return this.orderRepo.find({ where, order: { createdAt: 'DESC' } as any, take: 200 });
  }
  createOrder(dto: CreateMaintenanceOrderDto): Promise<MaintenanceOrder> {
    const order = this.orderRepo.create({
      ...(dto as any),
      scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : null,
      organizationId: this.org,
    });
    return this.orderRepo.save(order as any);
  }
  async updateOrder(id: string, dto: UpdateMaintenanceOrderDto): Promise<MaintenanceOrder> {
    const order = await this.orderRepo.findOne({ where: { id, organizationId: this.org } as any });
    if (!order) throw new NotFoundException('Maintenance order not found');
    if (dto.status) order.status = dto.status;
    if (dto.scheduledFor) order.scheduledFor = new Date(dto.scheduledFor);
    if (dto.assignedUserId !== undefined) order.assignedUserId = dto.assignedUserId ?? null;
    if (dto.note !== undefined) order.note = dto.note ?? null;
    if (order.status === MaintenanceOrderStatus.IN_PROGRESS && !order.startedAt) order.startedAt = new Date();
    if (order.status === MaintenanceOrderStatus.DONE) {
      order.completedAt = new Date();
      if (order.planId) {
        const plan = await this.planRepo.findOne({ where: { id: order.planId, organizationId: this.org } as any });
        if (plan) {
          plan.lastDoneAt = new Date();
          plan.nextDueAt = new Date(Date.now() + plan.intervalDays * DAY_MS);
          await this.planRepo.save(plan);
        }
      }
    }
    return this.orderRepo.save(order);
  }
}
