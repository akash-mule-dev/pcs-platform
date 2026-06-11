import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { Shipment, ShipmentStatus } from './shipment.entity.js';
import { ShipmentItem } from './shipment-item.entity.js';
import { AssemblyNode } from '../projects/assembly-node.entity.js';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { WorkOrderStage, WorkOrderStageStatus } from '../work-orders/work-order-stage.entity.js';
import { Ncr, NcrStatus } from '../quality-ncr/entities/ncr.entity.js';
import { TenantScopedService } from '../common/tenant/tenant-scoped.service.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { AddShipmentItemDto } from './dto/add-shipment-item.dto.js';

@Injectable()
export class ShippingService extends TenantScopedService<Shipment> {
  constructor(
    @InjectRepository(Shipment) repo: Repository<Shipment>,
    @InjectRepository(ShipmentItem) private readonly itemRepo: Repository<ShipmentItem>,
    @InjectRepository(AssemblyNode) private readonly nodeRepo: Repository<AssemblyNode>,
    @InjectRepository(WorkOrder) private readonly woRepo: Repository<WorkOrder>,
    @InjectRepository(WorkOrderStage) private readonly wosRepo: Repository<WorkOrderStage>,
    @InjectRepository(Ncr) private readonly ncrRepo: Repository<Ncr>,
  ) {
    super(repo);
  }

  async findByProject(projectId: string): Promise<Shipment[]> {
    return this.repo.find({
      where: { projectId, organizationId: TenantContext.requireOrganizationId() },
      relations: ['items', 'items.assemblyNode'],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Units of an assembly that have finished production, summed across ALL its
   * work orders (one per production order). A unit counts as complete once it
   * has been through every non-skipped stage; for status-only stage rows (no
   * quantity tracking) a fully completed work order counts as its quantity.
   */
  private async completedUnits(nodeId: string, organizationId: string): Promise<number> {
    const wos = await this.woRepo.find({ where: { organizationId, assemblyNodeId: nodeId } });
    if (!wos.length) return 0;
    const rows = await this.wosRepo.find({ where: { workOrderId: In(wos.map((w) => w.id)) } });
    const byWo = new Map<string, WorkOrderStage[]>();
    for (const r of rows) { const a = byWo.get(r.workOrderId) ?? []; a.push(r); byWo.set(r.workOrderId, a); }

    let units = 0;
    for (const wo of wos) {
      const active = (byWo.get(wo.id) ?? []).filter((r) => r.status !== WorkOrderStageStatus.SKIPPED);
      if (!active.length) continue;
      const allDone = active.every((r) => r.status === WorkOrderStageStatus.COMPLETED);
      const minDone = Math.min(...active.map((r) => Math.max(0, Math.min(r.qtyDone ?? 0, r.qtyTotal ?? 0))));
      units += allDone ? Math.max(minDone, wo.quantity ?? 1) : minDone;
    }
    return units;
  }

  /** Units of this assembly already on shipped/delivered loads. */
  private async shippedUnits(nodeId: string, organizationId: string): Promise<number> {
    const row = await this.itemRepo
      .createQueryBuilder('it')
      .innerJoin(Shipment, 's', 's.id = it.shipment_id')
      .where('it.assembly_node_id = :nodeId', { nodeId })
      .andWhere('it.organization_id = :org', { org: organizationId })
      .andWhere('s.status IN (:...done)', { done: [ShipmentStatus.SHIPPED, ShipmentStatus.DELIVERED] })
      .select('COALESCE(SUM(it.quantity), 0)', 'sum')
      .getRawOne<{ sum: string }>();
    return Number(row?.sum ?? 0);
  }

  /**
   * Add an assembly to a load — GATED: it must have production-complete units
   * left to ship (work-order stages done, across the project's work orders),
   * no open NCRs, and not already be fully allocated to other loads.
   */
  async addItem(shipmentId: string, dto: AddShipmentItemDto): Promise<ShipmentItem> {
    const organizationId = TenantContext.requireOrganizationId();
    const shipment = await this.findOne(shipmentId); // tenant check

    const node = await this.nodeRepo.findOne({ where: { id: dto.assemblyNodeId, organizationId } });
    if (!node) throw new NotFoundException('Assembly not found');
    const label = node.mark || node.name || 'Assembly';
    if (node.projectId !== shipment.projectId) {
      throw new BadRequestException(`${label} belongs to a different project than this load`);
    }

    const completed = await this.completedUnits(node.id, organizationId);
    if (completed <= 0) {
      throw new BadRequestException(`${label} cannot be shipped: its production stages are not complete yet.`);
    }

    const openNcr = await this.ncrRepo.count({
      where: { assemblyNodeId: node.id, organizationId, status: Not(In([NcrStatus.CLOSED, NcrStatus.CANCELLED])) },
    });
    if (openNcr > 0) {
      const plural = openNcr === 1 ? '' : 's';
      throw new BadRequestException(`${label} has ${openNcr} open NCR${plural} — close or disposition before shipping.`);
    }

    // Quantity guard: shipped so far + already planned on open loads + this add ≤ completed units.
    const planned = await this.itemRepo
      .createQueryBuilder('it')
      .innerJoin(Shipment, 's', 's.id = it.shipment_id')
      .where('it.assembly_node_id = :nodeId', { nodeId: node.id })
      .andWhere('it.organization_id = :org', { org: organizationId })
      .andWhere('s.status NOT IN (:...closed)', { closed: [ShipmentStatus.SHIPPED, ShipmentStatus.DELIVERED, ShipmentStatus.CANCELLED] })
      .select('COALESCE(SUM(it.quantity), 0)', 'sum')
      .getRawOne<{ sum: string }>();
    const alreadyPlanned = Number(planned?.sum ?? 0);
    const shipped = await this.shippedUnits(node.id, organizationId);
    const remaining = completed - shipped - alreadyPlanned;
    const qty = dto.quantity ?? 1;
    if (qty > remaining) {
      throw new BadRequestException(
        remaining <= 0
          ? `${label} is already fully shipped or allocated to loads.`
          : `Only ${remaining} unit(s) of ${label} left to ship — requested ${qty}.`,
      );
    }

    const item = this.itemRepo.create({
      shipmentId,
      assemblyNodeId: dto.assemblyNodeId,
      quantity: qty,
      organizationId,
    });
    return this.itemRepo.save(item);
  }

  async removeItem(shipmentId: string, itemId: string): Promise<void> {
    await this.findOne(shipmentId); // tenant check
    await this.itemRepo.delete({ id: itemId, shipmentId, organizationId: TenantContext.requireOrganizationId() });
  }

  /**
   * Set a shipment's status. What's shipped is derived from the loads
   * themselves (items on shipped/delivered shipments) — nothing is written
   * back onto the assembly tree.
   */
  async setStatus(id: string, status: ShipmentStatus): Promise<Shipment> {
    const organizationId = TenantContext.requireOrganizationId();
    const shipment = await this.repo.findOne({ where: { id, organizationId } });
    if (!shipment) throw new NotFoundException('Shipment not found');

    shipment.status = status;
    if (status === ShipmentStatus.SHIPPED && !shipment.shippedAt) shipment.shippedAt = new Date();
    return this.repo.save(shipment);
  }
}
