import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QualityData } from '../quality-data/quality-data.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { consensusSpec, xmrChart } from './spc-math.js';

/**
 * Statistical Process Control over quality inspection measurements.
 * Individuals (XmR) chart: sigma from the average moving range, Western
 * Electric rules 1–4, spec limits + Cp/Cpk from the series' consensus
 * tolerances. Tenant-scoped.
 *
 * Without a meshName the endpoint lists the model's measurable
 * CHARACTERISTICS (mesh × unit, with counts) so the UI can offer a picker —
 * mixing different characteristics into one chart is statistically
 * meaningless.
 */
@Injectable()
export class SpcService {
  constructor(@InjectRepository(QualityData) private readonly qdRepo: Repository<QualityData>) {}

  private scopedWhere(modelId?: string, meshName?: string): Record<string, any> {
    const where: any = { isActive: true };
    if (modelId) where.modelId = modelId;
    if (meshName) where.meshName = meshName;
    const org = TenantContext.getOrganizationId();
    if (org) where.organizationId = org;
    return where;
  }

  /** Measurable characteristics (mesh × unit) for a model, for the chart picker. */
  async characteristics(modelId?: string) {
    const qb = this.qdRepo.createQueryBuilder('qd')
      .select('qd.mesh_name', 'meshName')
      .addSelect('qd.measurement_unit', 'unit')
      .addSelect('COUNT(*)', 'count')
      .addSelect('MAX(qd.inspection_date)', 'lastAt')
      .where('qd.is_active = true')
      .andWhere('qd.measurement_value IS NOT NULL');
    if (modelId) qb.andWhere('qd.model_id = :modelId', { modelId });
    const org = TenantContext.getOrganizationId();
    if (org) qb.andWhere('qd.organization_id = :org', { org });
    const rows = await qb
      .groupBy('qd.mesh_name')
      .addGroupBy('qd.measurement_unit')
      .orderBy('COUNT(*)', 'DESC')
      .limit(50)
      .getRawMany();
    return rows.map((r) => ({
      meshName: r.meshName,
      unit: r.unit ?? null,
      count: parseInt(r.count, 10) || 0,
      lastAt: r.lastAt ?? null,
    }));
  }

  async controlChart(modelId?: string, meshName?: string) {
    // No characteristic picked → return the picker data instead of a mixed chart.
    if (!meshName) {
      const list = await this.characteristics(modelId);
      return {
        count: 0,
        points: [],
        violations: [],
        characteristics: list,
        message: list.length
          ? 'Pick a characteristic (meshName) to chart'
          : 'No measurement data for this selection',
      };
    }

    const rows = await this.qdRepo.find({
      where: this.scopedWhere(modelId, meshName),
      order: { inspectionDate: 'ASC', createdAt: 'ASC' } as any,
      take: 500,
    });
    const measured = rows.filter((r) => r.measurementValue !== null && r.measurementValue !== undefined);
    const spec = consensusSpec(measured);
    const chart = xmrChart(
      measured.map((r) => ({ value: Number(r.measurementValue), date: r.inspectionDate || r.createdAt })),
      spec,
    );
    return { meshName, ...chart };
  }
}
