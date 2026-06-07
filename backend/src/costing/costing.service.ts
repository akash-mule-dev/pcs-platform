import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TimeEntry } from '../time-tracking/time-entry.entity.js';
import { StockMovement, StockMovementType } from '../materials/entities/stock-movement.entity.js';
import { Organization } from '../organization/organization.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';

const DEFAULT_LABOR_RATE = 30; // currency units / hour, overridable via org settings.laborHourlyRate

/** Rolls captured labor time + material consumption into cost per work order. */
@Injectable()
export class CostingService {
  constructor(
    @InjectRepository(TimeEntry) private readonly teRepo: Repository<TimeEntry>,
    @InjectRepository(StockMovement) private readonly moveRepo: Repository<StockMovement>,
    @InjectRepository(Organization) private readonly orgRepo: Repository<Organization>,
  ) {}

  private get org(): string { return TenantContext.requireOrganizationId(); }

  private async laborRate(): Promise<number> {
    const o = await this.orgRepo.findOne({ where: { id: this.org } as any });
    const r = (o?.settings as any)?.laborHourlyRate;
    return typeof r === 'number' && r > 0 ? r : DEFAULT_LABOR_RATE;
  }

  async workOrderCost(workOrderId: string) {
    const rate = await this.laborRate();

    // Labor — time entries booked against this work order's stages.
    const entries = await this.teRepo
      .createQueryBuilder('te')
      .leftJoin('te.workOrderStage', 'wos')
      .where('wos.workOrderId = :woId', { woId: workOrderId })
      .getMany();
    const laborSeconds = entries.reduce((s, e) => s + (Number(e.durationSeconds) || 0), 0);
    const laborCost = (laborSeconds / 3600) * rate;

    // Material — stock issued against this work order.
    const issues = await this.moveRepo.find({
      where: { organizationId: this.org, workOrderId, type: StockMovementType.ISSUE } as any,
    });
    let materialCost = 0;
    const materials = issues.map((m) => {
      const unit = Number(m.material?.unitCost) || 0;
      const cost = unit * Number(m.quantity);
      materialCost += cost;
      return {
        materialId: m.materialId,
        code: m.material?.code,
        quantity: Number(m.quantity),
        unitCost: unit,
        cost: Number(cost.toFixed(2)),
      };
    });

    return {
      workOrderId,
      laborSeconds,
      laborHours: Number((laborSeconds / 3600).toFixed(2)),
      laborRate: rate,
      laborCost: Number(laborCost.toFixed(2)),
      materialCost: Number(materialCost.toFixed(2)),
      totalCost: Number((laborCost + materialCost).toFixed(2)),
      materials,
    };
  }
}
