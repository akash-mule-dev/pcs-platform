import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Material } from './entities/material.entity.js';
import { BomItem } from './entities/bom-item.entity.js';
import { TenantScopedService } from '../common/tenant/tenant-scoped.service.js';
import { CreateBomItemDto, UpdateBomItemDto } from './dto/bom.dto.js';

@Injectable()
export class MaterialsService extends TenantScopedService<Material> {
  constructor(
    @InjectRepository(Material) repo: Repository<Material>,
    @InjectRepository(BomItem) private readonly bomRepo: Repository<BomItem>,
  ) {
    super(repo);
  }

  // Material CRUD is inherited (tenant-scoped) from TenantScopedService.

  // ---- Bill of materials (per product) ----
  async getBom(productId: string): Promise<BomItem[]> {
    return this.bomRepo.find({
      where: { productId, organizationId: this.organizationId } as any,
    });
  }

  async addBomItem(dto: CreateBomItemDto): Promise<BomItem> {
    const item = this.bomRepo.create({
      ...(dto as any),
      organizationId: this.organizationId,
    });
    return this.bomRepo.save(item as any);
  }

  async updateBomItem(id: string, dto: UpdateBomItemDto): Promise<BomItem> {
    const item = await this.bomRepo.findOne({
      where: { id, organizationId: this.organizationId } as any,
    });
    if (!item) throw new NotFoundException('BOM item not found');
    Object.assign(item, dto);
    return this.bomRepo.save(item);
  }

  async removeBomItem(id: string): Promise<void> {
    const item = await this.bomRepo.findOne({
      where: { id, organizationId: this.organizationId } as any,
    });
    if (!item) throw new NotFoundException('BOM item not found');
    await this.bomRepo.remove(item);
  }
}
