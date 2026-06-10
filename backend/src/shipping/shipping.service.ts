import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { Shipment, ShipmentStatus } from './shipment.entity.js';
import { ShipmentItem } from './shipment-item.entity.js';
import { AssemblyNode, NodeProductionStatus } from '../projects/assembly-node.entity.js';
import { Ncr, NcrStatus } from '../quality-ncr/entities/ncr.entity.js';
import { StatusRollupService } from '../projects/status-rollup.service.js';
import { TenantScopedService } from '../common/tenant/tenant-scoped.service.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { AddShipmentItemDto } from './dto/add-shipment-item.dto.js';

@Injectable()
export class ShippingService extends TenantScopedService<Shipment> {
  constructor(
    @InjectRepository(Shipment) repo: Repository<Shipment>,
    @InjectRepository(ShipmentItem) private readonly itemRepo: Repository<ShipmentItem>,
    @InjectRepository(AssemblyNode) private readonly nodeRepo: Repository<AssemblyNode>,
    @InjectRepository(Ncr) private readonly ncrRepo: Repository<Ncr>,
    private readonly rollup: StatusRollupService,
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
   * Add an assembly to a load — GATED: the node must be ready_to_ship (every
   * work-order stage complete), have no open NCRs, and have unshipped quantity
   * left (also accounting for what's already planned on other open loads).
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

    if (node.productionStatus !== NodeProductionStatus.READY_TO_SHIP) {
      const why =
        node.productionStatus === NodeProductionStatus.SHIPPED
          ? 'it has already been fully shipped'
          : 'its production stages are not all complete yet';
      throw new BadRequestException(`${label} cannot be shipped: ${why}.`);
    }

    const openNcr = await this.ncrRepo.count({
      where: { assemblyNodeId: node.id, organizationId, status: Not(In([NcrStatus.CLOSED, NcrStatus.CANCELLED])) },
    });
    if (openNcr > 0) {
      const plural = openNcr === 1 ? '' : 's';
      throw new BadRequestException(`${label} has ${openNcr} open NCR${plural} — close or disposition before shipping.`);
    }

    // Quantity guard: shipped so far + already planned on unshipped loads + this add ≤ node quantity.
    const planned = await this.itemRepo
      .createQueryBuilder('it')
      .innerJoin(Shipment, 's', 's.id = it.shipment_id')
      .where('it.assembly_node_id = :nodeId', { nodeId: node.id })
      .andWhere('it.organization_id = :org', { org: organizationId })
      .andWhere('s.status NOT IN (:...closed)', { closed: [ShipmentStatus.SHIPPED, ShipmentStatus.DELIVERED, ShipmentStatus.CANCELLED] })
      .select('COALESCE(SUM(it.quantity), 0)', 'sum')
      .getRawOne<{ sum: string }>();
    const alreadyPlanned = Number(planned?.sum ?? 0);
    const remaining = (node.quantity ?? 1) - (node.qtyShipped ?? 0) - alreadyPlanned;
    const qty = dto.quantity ?? 1;
    if (qty > remaining) {
      throw new BadRequestException(
        remaining <= 0
          ? `${label} is already fully allocated to loads.`
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
   * Set a shipment's status. On the first transition into SHIPPED, advance each
   * item's assembly node (qty_shipped, SHIPPED when fully shipped) and recompute
   * that node's branch so parents/project roll up live.
   */
  async setStatus(id: string, status: ShipmentStatus): Promise<Shipment> {
    const organizationId = TenantContext.requireOrganizationId();
    const shipment = await this.repo.findOne({ where: { id, organizationId }, relations: ['items'] });
    if (!shipment) throw new NotFoundException('Shipment not found');

    const wasShipped = shipment.status === ShipmentStatus.SHIPPED || shipment.status === ShipmentStatus.DELIVERED;
    shipment.status = status;
    if (status === ShipmentStatus.SHIPPED && !shipment.shippedAt) shipment.shippedAt = new Date();
    await this.repo.save(shipment);

    if (status === ShipmentStatus.SHIPPED && !wasShipped) {
      const affected: string[] = [];
      for (const item of shipment.items ?? []) {
        const node = await this.nodeRepo.findOne({ where: { id: item.assemblyNodeId, organizationId } });
        if (!node) continue;
        const qty = node.quantity ?? 1;
        node.qtyShipped = Math.min((node.qtyShipped ?? 0) + (item.quantity ?? 1), qty);
        if (node.qtyShipped >= qty) node.productionStatus = NodeProductionStatus.SHIPPED;
        await this.nodeRepo.save(node);
        affected.push(node.id);
      }
      // Live roll-up: re-aggregate each shipped assembly's ancestor chain (best-effort).
      for (const nodeId of affected) {
        try { await this.rollup.recomputeBranchForNode(nodeId, organizationId); } catch { /* non-fatal */ }
      }
    }
    return shipment;
  }
}
