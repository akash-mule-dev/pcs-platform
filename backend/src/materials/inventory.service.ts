import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DeepPartial } from 'typeorm';
import { MaterialStock } from './entities/material-stock.entity.js';
import { StockMovement, StockMovementType } from './entities/stock-movement.entity.js';
import { BomItem } from './entities/bom-item.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { ReceiveStockDto, IssueStockDto, AdjustStockDto, ScrapStockDto } from './dto/inventory.dto.js';

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(MaterialStock) private readonly stockRepo: Repository<MaterialStock>,
    @InjectRepository(StockMovement) private readonly moveRepo: Repository<StockMovement>,
    @InjectRepository(BomItem) private readonly bomRepo: Repository<BomItem>,
  ) {}

  private get org(): string {
    return TenantContext.requireOrganizationId();
  }
  private get userId(): string | null {
    return TenantContext.get()?.userId ?? null;
  }

  async getStock(): Promise<MaterialStock[]> {
    return this.stockRepo.find({ where: { organizationId: this.org } as any });
  }

  async getMovements(materialId?: string): Promise<StockMovement[]> {
    const where: any = { organizationId: this.org };
    if (materialId) where.materialId = materialId;
    return this.moveRepo.find({ where, order: { createdAt: 'DESC' }, take: 200 });
  }

  private async getOrCreateStock(materialId: string, location = 'MAIN'): Promise<MaterialStock> {
    let row = await this.stockRepo.findOne({
      where: { organizationId: this.org, materialId, location } as any,
    });
    if (!row) {
      row = this.stockRepo.create({
        organizationId: this.org,
        materialId,
        location,
        quantityOnHand: 0,
        quantityReserved: 0,
      } as DeepPartial<MaterialStock>);
      row = await this.stockRepo.save(row);
    }
    return row;
  }

  private async record(
    type: StockMovementType,
    materialId: string,
    quantity: number,
    location: string,
    extra: Partial<StockMovement> = {},
  ): Promise<void> {
    const mv = this.moveRepo.create({
      organizationId: this.org,
      type,
      materialId,
      quantity,
      location,
      createdBy: this.userId,
      ...(extra as any),
    } as any);
    await this.moveRepo.save(mv as any);
  }

  async receive(dto: ReceiveStockDto): Promise<MaterialStock> {
    const loc = dto.location || 'MAIN';
    const stock = await this.getOrCreateStock(dto.materialId, loc);
    stock.quantityOnHand = Number(stock.quantityOnHand) + Number(dto.quantity);
    await this.stockRepo.save(stock);
    await this.record(StockMovementType.RECEIPT, dto.materialId, dto.quantity, loc, {
      reference: dto.reference ?? null,
      note: dto.note ?? null,
    });
    return stock;
  }

  async issue(dto: IssueStockDto): Promise<MaterialStock> {
    const loc = dto.location || 'MAIN';
    const stock = await this.getOrCreateStock(dto.materialId, loc);
    if (Number(stock.quantityOnHand) < Number(dto.quantity)) {
      throw new BadRequestException(
        `Insufficient stock: on hand ${stock.quantityOnHand}, requested ${dto.quantity}`,
      );
    }
    stock.quantityOnHand = Number(stock.quantityOnHand) - Number(dto.quantity);
    await this.stockRepo.save(stock);
    await this.record(StockMovementType.ISSUE, dto.materialId, dto.quantity, loc, {
      workOrderId: dto.workOrderId ?? null,
      note: dto.note ?? null,
    });
    return stock;
  }

  async scrap(dto: ScrapStockDto): Promise<MaterialStock> {
    const loc = dto.location || 'MAIN';
    const stock = await this.getOrCreateStock(dto.materialId, loc);
    stock.quantityOnHand = Math.max(0, Number(stock.quantityOnHand) - Number(dto.quantity));
    await this.stockRepo.save(stock);
    await this.record(StockMovementType.SCRAP, dto.materialId, dto.quantity, loc, {
      workOrderId: dto.workOrderId ?? null,
      note: dto.note ?? null,
    });
    return stock;
  }

  async adjust(dto: AdjustStockDto): Promise<MaterialStock> {
    const loc = dto.location || 'MAIN';
    const stock = await this.getOrCreateStock(dto.materialId, loc);
    const delta = Number(dto.quantityOnHand) - Number(stock.quantityOnHand);
    stock.quantityOnHand = Number(dto.quantityOnHand);
    await this.stockRepo.save(stock);
    await this.record(StockMovementType.ADJUSTMENT, dto.materialId, Math.abs(delta), loc, {
      note: dto.note ?? null,
    });
    return stock;
  }

  /**
   * Material availability for a planned build of `quantity` units of `productId`.
   * Used as the pre-release shortage check before a work order can start.
   */
  async checkAvailability(productId: string, quantity: number) {
    const bom = await this.bomRepo.find({
      where: { organizationId: this.org, productId } as any,
    });

    const requirements: Array<{
      materialId: string;
      materialCode?: string;
      materialName?: string;
      unit?: string;
      requiredQuantity: number;
      availableQuantity: number;
      shortageQuantity: number;
      sufficient: boolean;
    }> = [];
    for (const item of bom) {
      const required = Number(item.quantityPer) * quantity * (1 + Number(item.scrapPct || 0) / 100);
      const stocks = await this.stockRepo.find({
        where: { organizationId: this.org, materialId: item.materialId } as any,
      });
      const available = stocks.reduce(
        (sum, r) => sum + (Number(r.quantityOnHand) - Number(r.quantityReserved)),
        0,
      );
      const shortage = Math.max(0, required - available);
      requirements.push({
        materialId: item.materialId,
        materialCode: item.material?.code,
        materialName: item.material?.name,
        unit: item.material?.unitOfMeasure,
        requiredQuantity: Number(required.toFixed(4)),
        availableQuantity: Number(available.toFixed(4)),
        shortageQuantity: Number(shortage.toFixed(4)),
        sufficient: shortage <= 0,
      });
    }

    const shortages = requirements.filter((r) => !r.sufficient);
    return {
      productId,
      quantity,
      hasBom: bom.length > 0,
      canRelease: shortages.length === 0,
      requirements,
      shortages,
    };
  }
}
