import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shipment, ShipmentStatus } from './shipment.entity.js';
import { ShipmentItem } from './shipment-item.entity.js';
import { AssemblyNode, NodeProductionStatus } from '../projects/assembly-node.entity.js';
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

  async addItem(shipmentId: string, dto: AddShipmentItemDto): Promise<ShipmentItem> {
    await this.findOne(shipmentId); // tenant check
    const item = this.itemRepo.create({
      shipmentId,
      assemblyNodeId: dto.assemblyNodeId,
      quantity: dto.quantity ?? 1,
      organizationId: TenantContext.requireOrganizationId(),
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
