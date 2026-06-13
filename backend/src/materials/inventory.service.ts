import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { Material } from './entities/material.entity.js';
import { MaterialStock } from './entities/material-stock.entity.js';
import { StockMovement, StockMovementType } from './entities/stock-movement.entity.js';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { ProductionOrder, ProductionOrderStatus } from '../projects/production-order.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { movingAverage, stockValue, isLowStock, round2 } from './inventory-math.js';
import { ReceiveStockDto, IssueStockDto, ReturnStockDto, AdjustStockDto, ScrapStockDto } from './dto/inventory.dto.js';

/**
 * Stock keeping + MOVING-AVERAGE valuation.
 *
 * Every mutation runs in ONE transaction with a pessimistic lock on the stock
 * row (and the material row when the average moves), so concurrent receipts /
 * issues can't lose updates or drive stock negative. Every movement stamps the
 * unit cost at the moment it happened — the costing engine reads the ledger,
 * never today's price, so a finished order's cost is immutable history.
 */
@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(MaterialStock) private readonly stockRepo: Repository<MaterialStock>,
    @InjectRepository(StockMovement) private readonly moveRepo: Repository<StockMovement>,
    @InjectRepository(Material) private readonly materialRepo: Repository<Material>,
    @InjectRepository(WorkOrder) private readonly woRepo: Repository<WorkOrder>,
    @InjectRepository(ProductionOrder) private readonly orderRepo: Repository<ProductionOrder>,
    private readonly dataSource: DataSource,
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

  /**
   * One-call inventory overview for the UI: every material with its aggregated
   * on-hand/reserved, moving-average cost, stock value and low-stock flag.
   */
  async getSummary() {
    const org = this.org;
    const materials = await this.materialRepo.find({ where: { organizationId: org } as any, order: { code: 'ASC' } });
    const stock = await this.stockRepo.find({ where: { organizationId: org } as any });
    const byMaterial = new Map<string, { onHand: number; reserved: number }>();
    for (const s of stock) {
      const agg = byMaterial.get(s.materialId) ?? { onHand: 0, reserved: 0 };
      agg.onHand += Number(s.quantityOnHand) || 0;
      agg.reserved += Number(s.quantityReserved) || 0;
      byMaterial.set(s.materialId, agg);
    }
    const rows = materials.map((m) => {
      const agg = byMaterial.get(m.id) ?? { onHand: 0, reserved: 0 };
      return {
        id: m.id,
        code: m.code,
        name: m.name,
        type: m.type,
        unitOfMeasure: m.unitOfMeasure,
        specification: m.specification,
        profile: m.profile,
        materialGrade: m.materialGrade,
        unitCost: Number(m.unitCost) || 0,
        reorderLevel: Number(m.reorderLevel) || 0,
        isActive: m.isActive,
        onHand: Math.round(agg.onHand * 1000) / 1000,
        reserved: Math.round(agg.reserved * 1000) / 1000,
        value: stockValue(agg.onHand, Number(m.unitCost) || 0),
        lowStock: isLowStock(agg.onHand, Number(m.reorderLevel) || 0),
      };
    });
    return {
      materials: rows,
      totals: {
        materials: rows.length,
        totalValue: round2(rows.reduce((s, r) => s + r.value, 0)),
        lowStock: rows.filter((r) => r.lowStock).length,
      },
    };
  }

  async getMovements(filter: { materialId?: string; productionOrderId?: string; workOrderId?: string } = {}): Promise<StockMovement[]> {
    const where: any = { organizationId: this.org };
    if (filter.materialId) where.materialId = filter.materialId;
    if (filter.productionOrderId) where.productionOrderId = filter.productionOrderId;
    if (filter.workOrderId) where.workOrderId = filter.workOrderId;
    return this.moveRepo.find({ where, order: { createdAt: 'DESC' }, take: 200 });
  }

  // ── Transactional core ─────────────────────────────────────────────────────

  /** Lock (or create) the stock row for material+location inside the transaction. */
  private async lockStock(em: EntityManager, org: string, materialId: string, location: string): Promise<MaterialStock> {
    let row = await em
      .getRepository(MaterialStock)
      .createQueryBuilder('s')
      .setLock('pessimistic_write')
      .where('s.organizationId = :org AND s.materialId = :materialId AND s.location = :location', { org, materialId, location })
      .getOne();
    if (!row) {
      // Insert-then-lock so two first-movers serialize on the unique index.
      try {
        await em.getRepository(MaterialStock).insert({
          organizationId: org, materialId, location, quantityOnHand: 0, quantityReserved: 0,
        } as any);
      } catch (e: any) {
        if (e?.code !== '23505') throw e; // unique race: someone else created it — fall through and lock theirs
      }
      row = await em
        .getRepository(MaterialStock)
        .createQueryBuilder('s')
        .setLock('pessimistic_write')
        .where('s.organizationId = :org AND s.materialId = :materialId AND s.location = :location', { org, materialId, location })
        .getOne();
      if (!row) throw new BadRequestException('Could not allocate a stock record for this material');
    }
    return row;
  }

  private async lockMaterial(em: EntityManager, org: string, materialId: string): Promise<Material> {
    const material = await em
      .getRepository(Material)
      .createQueryBuilder('m')
      .setLock('pessimistic_write')
      .where('m.id = :materialId AND m.organizationId = :org', { materialId, org })
      .getOne();
    if (!material) throw new NotFoundException('Material not found');
    return material;
  }

  /**
   * Resolve + validate the production-order / work-order references:
   *  - both must belong to the caller's org;
   *  - a work order implies its production order (stamped automatically);
   *  - consumption against a completed/cancelled order is rejected (use a
   *    plain unreferenced movement for genuine post-completion corrections).
   */
  private async resolveRefs(
    em: EntityManager,
    org: string,
    dto: { productionOrderId?: string; workOrderId?: string },
    enforceOpenOrder: boolean,
  ): Promise<{ productionOrderId: string | null; workOrderId: string | null }> {
    let productionOrderId = dto.productionOrderId ?? null;
    const workOrderId = dto.workOrderId ?? null;

    if (workOrderId) {
      const wo = await em.getRepository(WorkOrder).findOne({ where: { id: workOrderId, organizationId: org } as any });
      if (!wo) throw new NotFoundException('Work order not found');
      if (productionOrderId && wo.productionOrderId && wo.productionOrderId !== productionOrderId) {
        throw new BadRequestException('That work order belongs to a different production order');
      }
      productionOrderId = productionOrderId ?? wo.productionOrderId ?? null;
    }
    if (productionOrderId) {
      const order = await em.getRepository(ProductionOrder).findOne({ where: { id: productionOrderId, organizationId: org } as any });
      if (!order) throw new NotFoundException('Production order not found');
      if (enforceOpenOrder && (order.status === ProductionOrderStatus.COMPLETED || order.status === ProductionOrderStatus.CANCELLED)) {
        throw new BadRequestException(`Order ${order.number} is ${order.status} — material can no longer be booked against it`);
      }
    }
    return { productionOrderId, workOrderId };
  }

  private buildMovement(
    em: EntityManager,
    org: string,
    type: StockMovementType,
    materialId: string,
    quantity: number,
    unitCost: number | null,
    location: string,
    extra: Partial<StockMovement> = {},
  ): Promise<StockMovement> {
    const mv = em.getRepository(StockMovement).create({
      organizationId: org,
      type,
      materialId,
      quantity,
      unitCost,
      location,
      createdBy: this.userId,
      ...(extra as any),
    } as any);
    return em.getRepository(StockMovement).save(mv as any) as Promise<StockMovement>;
  }

  // ── Operations ─────────────────────────────────────────────────────────────

  /** Receive stock. A provided unit cost re-averages the material's moving-average cost. */
  async receive(dto: ReceiveStockDto) {
    const org = this.org;
    const loc = dto.location || 'MAIN';
    return this.dataSource.transaction(async (em) => {
      const material = await this.lockMaterial(em, org, dto.materialId);
      const stock = await this.lockStock(em, org, dto.materialId, loc);

      let stampedCost = Number(material.unitCost) || 0;
      if (dto.unitCost !== undefined && dto.unitCost !== null) {
        // Average over the material's TOTAL on-hand (all locations), not just this row.
        const { total } = await em
          .getRepository(MaterialStock)
          .createQueryBuilder('s')
          .select('COALESCE(SUM(s.quantity_on_hand), 0)', 'total')
          .where('s.organization_id = :org AND s.material_id = :materialId', { org, materialId: dto.materialId })
          .getRawOne();
        const newAvg = movingAverage(Number(total) || 0, Number(material.unitCost) || 0, dto.quantity, dto.unitCost);
        material.unitCost = newAvg;
        await em.getRepository(Material).save(material);
        stampedCost = round2(dto.unitCost);
      }

      stock.quantityOnHand = Math.round((Number(stock.quantityOnHand) + Number(dto.quantity)) * 1000) / 1000;
      await em.getRepository(MaterialStock).save(stock);
      const movement = await this.buildMovement(em, org, StockMovementType.RECEIPT, dto.materialId, dto.quantity, stampedCost, loc, {
        reference: dto.reference ?? null,
        note: dto.note ?? null,
      });
      return { stock, movement, unitCost: Number(material.unitCost) || 0 };
    });
  }

  /** Issue stock to production — stamps the moving-average cost + order links onto the ledger row. */
  async issue(dto: IssueStockDto) {
    return this.consume(StockMovementType.ISSUE, dto);
  }

  /** Scrap stock (offcut loss / damage) — costed like an issue. */
  async scrap(dto: ScrapStockDto) {
    return this.consume(StockMovementType.SCRAP, dto);
  }

  private async consume(type: StockMovementType.ISSUE | StockMovementType.SCRAP, dto: IssueStockDto | ScrapStockDto) {
    const org = this.org;
    const loc = dto.location || 'MAIN';
    return this.dataSource.transaction(async (em) => {
      const material = await this.lockMaterial(em, org, dto.materialId);
      const refs = await this.resolveRefs(em, org, dto, true);
      const stock = await this.lockStock(em, org, dto.materialId, loc);
      if (Number(stock.quantityOnHand) < Number(dto.quantity)) {
        throw new BadRequestException(
          `Insufficient stock of ${material.code}: on hand ${stock.quantityOnHand} ${material.unitOfMeasure}, requested ${dto.quantity}`,
        );
      }
      stock.quantityOnHand = Math.round((Number(stock.quantityOnHand) - Number(dto.quantity)) * 1000) / 1000;
      await em.getRepository(MaterialStock).save(stock);
      const movement = await this.buildMovement(em, org, type, dto.materialId, dto.quantity, Number(material.unitCost) || 0, loc, {
        productionOrderId: refs.productionOrderId,
        workOrderId: refs.workOrderId,
        note: dto.note ?? null,
      });
      return { stock, movement };
    });
  }

  /** Return previously issued material to stock (reverses an issue at the current average cost). */
  async returnStock(dto: ReturnStockDto) {
    const org = this.org;
    const loc = dto.location || 'MAIN';
    return this.dataSource.transaction(async (em) => {
      const material = await this.lockMaterial(em, org, dto.materialId);
      const refs = await this.resolveRefs(em, org, dto, false); // returns are allowed even after the order closed
      const stock = await this.lockStock(em, org, dto.materialId, loc);
      stock.quantityOnHand = Math.round((Number(stock.quantityOnHand) + Number(dto.quantity)) * 1000) / 1000;
      await em.getRepository(MaterialStock).save(stock);
      const movement = await this.buildMovement(em, org, StockMovementType.RETURN, dto.materialId, dto.quantity, Number(material.unitCost) || 0, loc, {
        productionOrderId: refs.productionOrderId,
        workOrderId: refs.workOrderId,
        note: dto.note ?? null,
      });
      return { stock, movement };
    });
  }

  /** Set the absolute on-hand quantity (stock count correction). */
  async adjust(dto: AdjustStockDto) {
    const org = this.org;
    const loc = dto.location || 'MAIN';
    return this.dataSource.transaction(async (em) => {
      const material = await this.lockMaterial(em, org, dto.materialId);
      const stock = await this.lockStock(em, org, dto.materialId, loc);
      const delta = Number(dto.quantityOnHand) - Number(stock.quantityOnHand);
      stock.quantityOnHand = Number(dto.quantityOnHand);
      await em.getRepository(MaterialStock).save(stock);
      const movement = await this.buildMovement(
        em, org, StockMovementType.ADJUSTMENT, dto.materialId, Math.abs(delta), Number(material.unitCost) || 0, loc,
        { note: dto.note ? `${delta >= 0 ? '+' : '−'}${Math.abs(delta)} — ${dto.note}` : `${delta >= 0 ? '+' : '−'}${Math.abs(delta)} (count correction)` },
      );
      return { stock, movement };
    });
  }
}
