import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shipment } from './shipment.entity.js';
import { ShipmentItem } from './shipment-item.entity.js';
import { TenantScopedService } from '../common/tenant/tenant-scoped.service.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { AddShipmentItemDto } from './dto/add-shipment-item.dto.js';

@Injectable()
export class ShippingService extends TenantScopedService<Shipment> {
  constructor(
    @InjectRepository(Shipment) repo: Repository<Shipment>,
    @InjectRepository(ShipmentItem) private readonly itemRepo: Repository<ShipmentItem>,
  ) {
    super(repo);
  }

  async findByProject(projectId: string): Promise<Shipment[]> {
    return this.repo.find({
      where: { projectId, organizationId: TenantContext.requireOrganizationId() },
      relations: ['items'],
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
}
