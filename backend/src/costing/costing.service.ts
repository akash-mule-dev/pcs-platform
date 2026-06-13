import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { ProductionOrder } from '../projects/production-order.entity.js';
import { Project } from '../projects/project.entity.js';
import { Organization } from '../organization/organization.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { AuditService } from '../audit/audit.service.js';
import { MaterialRequirementsService } from '../projects/material-requirements.service.js';
import {
  CostingSettings, normalizeSettings, composeTotals, variance, round2,
} from './costing-math.js';
import { UpdateCostingSettingsDto } from './costing.dto.js';

/**
 * Work-order costing: rolls MATERIAL consumption (stamped ledger costs),
 * LABOR (clocked time × worker→stage→default rate) and OVERHEAD (% on labor)
 * up the chain — per-assembly work order → production order → project — and
 * pairs every actual with its estimate (BOM × prices, stage targets × rates).
 *
 * All heavy lifting happens in batched SQL aggregates (never N+1 per row);
 * every read is org-scoped.
 */
@Injectable()
export class CostingService {
  constructor(
    @InjectRepository(WorkOrder) private readonly woRepo: Repository<WorkOrder>,
    @InjectRepository(ProductionOrder) private readonly orderRepo: Repository<ProductionOrder>,
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    @InjectRepository(Organization) private readonly orgRepo: Repository<Organization>,
    private readonly requirements: MaterialRequirementsService,
    private readonly audit: AuditService,
  ) {}

  private get org(): string { return TenantContext.requireOrganizationId(); }

  // ── Settings ───────────────────────────────────────────────────────────────

  async getSettings(): Promise<CostingSettings & { configured: boolean }> {
    const o = await this.orgRepo.findOne({ where: { id: this.org } });
    const raw = (o?.settings as any)?.costing;
    return { ...normalizeSettings(raw, (o?.settings as any)?.laborHourlyRate), configured: !!raw };
  }

  async updateSettings(dto: UpdateCostingSettingsDto): Promise<CostingSettings & { configured: boolean }> {
    const o = await this.orgRepo.findOne({ where: { id: this.org } });
    if (!o) throw new NotFoundException('Organization not found');
    const before = normalizeSettings((o.settings as any)?.costing, (o.settings as any)?.laborHourlyRate);
    const next = normalizeSettings({ ...before, ...dto }, undefined);
    o.settings = { ...(o.settings ?? {}), costing: next };
    await this.orgRepo.save(o);
    await this.audit.log({
      userId: TenantContext.get()?.userId ?? null,
      action: 'update',
      entityType: 'costing-settings',
      entityId: o.id,
      oldValues: before as any,
      newValues: next as any,
    });
    return { ...next, configured: true };
  }

  // ── SQL aggregates (shared) ────────────────────────────────────────────────

  /**
   * Labor actuals grouped by work order: paid seconds + cost with the rate
   * resolved PER ENTRY (worker → stage → default) inside the query.
   */
  private async laborByWorkOrder(filterSql: string, params: any[], defaultRate: number): Promise<Map<string, { seconds: number; cost: number; entries: number }>> {
    const rows: { wo_id: string; seconds: string; cost: string; entries: string }[] = await this.woRepo.query(
      `SELECT s.work_order_id AS wo_id,
              COALESCE(SUM(GREATEST(COALESCE(te.duration_seconds, 0) - COALESCE(te.break_seconds, 0), 0)), 0)::bigint AS seconds,
              COALESCE(SUM(
                GREATEST(COALESCE(te.duration_seconds, 0) - COALESCE(te.break_seconds, 0), 0) / 3600.0
                * COALESCE(NULLIF(u.hourly_rate, 0), NULLIF(st.hourly_rate, 0), $${params.length + 1})
              ), 0) AS cost,
              COUNT(te.id)::int AS entries
         FROM time_entries te
         JOIN work_order_stages s ON s.id = te.work_order_stage_id
         JOIN work_orders w ON w.id = s.work_order_id
         LEFT JOIN stages st ON st.id = s.stage_id
         LEFT JOIN users u ON u.id = te.user_id
        WHERE ${filterSql}
        GROUP BY s.work_order_id`,
      [...params, defaultRate],
    );
    return new Map(rows.map((r) => [r.wo_id, { seconds: Number(r.seconds), cost: round2(Number(r.cost)), entries: Number(r.entries) }]));
  }

  /** Labor ESTIMATE grouped by work order: stage target × planned units × (stage rate | default). */
  private async laborEstimateByWorkOrder(filterSql: string, params: any[], defaultRate: number): Promise<Map<string, { seconds: number; cost: number }>> {
    const rows: { wo_id: string; seconds: string; cost: string }[] = await this.woRepo.query(
      `SELECT s.work_order_id AS wo_id,
              COALESCE(SUM(COALESCE(st.target_time_seconds, 0) * COALESCE(s.qty_total, 0)), 0)::bigint AS seconds,
              COALESCE(SUM(
                COALESCE(st.target_time_seconds, 0) * COALESCE(s.qty_total, 0) / 3600.0
                * COALESCE(NULLIF(st.hourly_rate, 0), $${params.length + 1})
              ), 0) AS cost
         FROM work_order_stages s
         JOIN work_orders w ON w.id = s.work_order_id
         LEFT JOIN stages st ON st.id = s.stage_id
        WHERE s.status <> 'skipped' AND ${filterSql}
        GROUP BY s.work_order_id`,
      [...params, defaultRate],
    );
    return new Map(rows.map((r) => [r.wo_id, { seconds: Number(r.seconds), cost: round2(Number(r.cost)) }]));
  }

  /**
   * Net material consumption (issues + scrap − returns) at STAMPED unit costs
   * (material's current cost backfills pre-costing legacy rows), grouped by an
   * arbitrary key column of stock_movements.
   */
  private async materialByKey(keyCol: 'work_order_id' | 'production_order_id', filterSql: string, params: any[]): Promise<Map<string, number>> {
    const rows: { key: string; cost: string }[] = await this.woRepo.query(
      `SELECT mv.${keyCol} AS key,
              COALESCE(SUM(
                (CASE WHEN mv.type IN ('issue','scrap') THEN 1 WHEN mv.type = 'return' THEN -1 ELSE 0 END)
                * mv.quantity * COALESCE(mv.unit_cost, m.unit_cost, 0)
              ), 0) AS cost
         FROM stock_movements mv
         LEFT JOIN materials m ON m.id = mv.material_id
        WHERE mv.${keyCol} IS NOT NULL AND ${filterSql}
        GROUP BY mv.${keyCol}`,
      params,
    );
    return new Map(rows.map((r) => [r.key, round2(Math.max(0, Number(r.cost)))]));
  }

  /** Per-material consumption detail for one scope (order or work order). */
  private async materialDetail(whereSql: string, params: any[]) {
    const rows: any[] = await this.woRepo.query(
      `SELECT mv.material_id, m.code, m.name, m.unit_of_measure,
              COALESCE(SUM(CASE WHEN mv.type IN ('issue','scrap') THEN mv.quantity WHEN mv.type = 'return' THEN -mv.quantity ELSE 0 END), 0) AS qty,
              COALESCE(SUM(
                (CASE WHEN mv.type IN ('issue','scrap') THEN 1 WHEN mv.type = 'return' THEN -1 ELSE 0 END)
                * mv.quantity * COALESCE(mv.unit_cost, m.unit_cost, 0)
              ), 0) AS cost
         FROM stock_movements mv
         LEFT JOIN materials m ON m.id = mv.material_id
        WHERE ${whereSql}
        GROUP BY mv.material_id, m.code, m.name, m.unit_of_measure
        ORDER BY cost DESC`,
      params,
    );
    return rows
      .map((r) => ({
        materialId: r.material_id,
        code: r.code,
        name: r.name,
        unitOfMeasure: r.unit_of_measure,
        quantity: Math.round(Math.max(0, Number(r.qty)) * 1000) / 1000,
        cost: round2(Math.max(0, Number(r.cost))),
      }))
      .filter((r) => r.quantity > 0 || r.cost > 0);
  }

  /** Are any personal/stage rates configured? Drives the "using defaults" hint in the UI. */
  private async ratesConfigured(): Promise<{ workersWithRate: number; stagesWithRate: number }> {
    const [w, s] = await Promise.all([
      this.woRepo.query(`SELECT COUNT(*)::int AS n FROM users WHERE organization_id = $1 AND COALESCE(hourly_rate, 0) > 0`, [this.org]),
      this.woRepo.query(`SELECT COUNT(*)::int AS n FROM stages WHERE organization_id = $1 AND COALESCE(hourly_rate, 0) > 0`, [this.org]),
    ]);
    return { workersWithRate: Number(w?.[0]?.n ?? 0), stagesWithRate: Number(s?.[0]?.n ?? 0) };
  }

  // ── Per-assembly work order ────────────────────────────────────────────────

  async workOrderCost(workOrderId: string) {
    const org = this.org;
    const wo = await this.woRepo.findOne({ where: { id: workOrderId, organizationId: org } as any, relations: ['assemblyNode'] });
    if (!wo) throw new NotFoundException('Work order not found');
    const settings = await this.getSettings();

    const [laborMap, laborEstMap, materialMap, materials, workers] = await Promise.all([
      this.laborByWorkOrder('te.organization_id = $1 AND s.work_order_id = $2', [org, workOrderId], settings.defaultLaborRate),
      this.laborEstimateByWorkOrder('s.organization_id = $1 AND s.work_order_id = $2', [org, workOrderId], settings.defaultLaborRate),
      this.materialByKey('work_order_id', 'mv.organization_id = $1 AND mv.work_order_id = $2', [org, workOrderId]),
      this.materialDetail('mv.organization_id = $1 AND mv.work_order_id = $2', [org, workOrderId]),
      this.woRepo.query(
        `SELECT u.id, u.first_name, u.last_name,
                COALESCE(SUM(GREATEST(COALESCE(te.duration_seconds,0) - COALESCE(te.break_seconds,0), 0)), 0)::bigint AS seconds,
                COALESCE(SUM(
                  GREATEST(COALESCE(te.duration_seconds,0) - COALESCE(te.break_seconds,0), 0) / 3600.0
                  * COALESCE(NULLIF(u.hourly_rate, 0), NULLIF(st.hourly_rate, 0), $3)
                ), 0) AS cost
           FROM time_entries te
           JOIN work_order_stages s ON s.id = te.work_order_stage_id
           LEFT JOIN stages st ON st.id = s.stage_id
           LEFT JOIN users u ON u.id = te.user_id
          WHERE te.organization_id = $1 AND s.work_order_id = $2
          GROUP BY u.id, u.first_name, u.last_name
          ORDER BY cost DESC`,
        [org, workOrderId, settings.defaultLaborRate],
      ),
    ]);

    const labor = laborMap.get(workOrderId) ?? { seconds: 0, cost: 0, entries: 0 };
    const laborEst = laborEstMap.get(workOrderId) ?? { seconds: 0, cost: 0 };
    const materialCost = materialMap.get(workOrderId) ?? 0;
    const totals = composeTotals(materialCost, labor.cost, settings.overheadPercent);
    const estTotals = composeTotals(0, laborEst.cost, settings.overheadPercent); // material estimate lives at order level (BOM × qty)

    return {
      workOrderId,
      orderNumber: wo.orderNumber,
      productionOrderId: wo.productionOrderId,
      mark: wo.assemblyNode?.mark || wo.assemblyNode?.name || wo.orderNumber,
      currency: settings.currency,
      settings,
      labor: {
        seconds: labor.seconds,
        hours: round2(labor.seconds / 3600),
        cost: labor.cost,
        entries: labor.entries,
        estimatedSeconds: laborEst.seconds,
        estimatedHours: round2(laborEst.seconds / 3600),
        estimatedCost: laborEst.cost,
        variance: variance(labor.cost, laborEst.cost),
      },
      material: { cost: totals.materialCost, items: materials },
      overhead: { percent: settings.overheadPercent, cost: totals.overheadCost },
      totalCost: totals.totalCost,
      estimatedLaborPlusOverhead: estTotals.totalCost,
      workers: (workers as any[]).map((w) => ({
        id: w.id,
        name: [w.first_name, w.last_name].filter(Boolean).join(' ') || 'Unknown',
        seconds: Number(w.seconds),
        hours: round2(Number(w.seconds) / 3600),
        cost: round2(Number(w.cost)),
      })),
    };
  }

  // ── Production order ───────────────────────────────────────────────────────

  async orderCost(orderId: string) {
    const org = this.org;
    const order = await this.orderRepo.findOne({ where: { id: orderId, organizationId: org } as any });
    if (!order) throw new NotFoundException('Production order not found');
    const settings = await this.getSettings();

    const wos = await this.woRepo.find({ where: { productionOrderId: orderId, organizationId: org } as any, relations: ['assemblyNode'] });
    const [laborMap, laborEstMap, materialByWo, materialDetail, rates, requirements] = await Promise.all([
      this.laborByWorkOrder('te.organization_id = $1 AND w.production_order_id = $2', [org, orderId], settings.defaultLaborRate),
      this.laborEstimateByWorkOrder('s.organization_id = $1 AND w.production_order_id = $2', [org, orderId], settings.defaultLaborRate),
      this.materialByKey('work_order_id', 'mv.organization_id = $1 AND mv.production_order_id = $2', [org, orderId]),
      this.materialDetail('mv.organization_id = $1 AND mv.production_order_id = $2', [org, orderId]),
      this.ratesConfigured(),
      this.requirements.orderRequirements(orderId),
    ]);

    // Order-level material total comes from the ledger by production_order_id
    // (includes rows not pinned to a specific assembly's work order).
    const materialTotal = round2(materialDetail.reduce((s, m) => s + m.cost, 0));
    const laborTotal = round2([...laborMap.values()].reduce((s, l) => s + l.cost, 0));
    const laborSeconds = [...laborMap.values()].reduce((s, l) => s + l.seconds, 0);
    const laborEstTotal = round2([...laborEstMap.values()].reduce((s, l) => s + l.cost, 0));
    const laborEstSeconds = [...laborEstMap.values()].reduce((s, l) => s + l.seconds, 0);

    const totals = composeTotals(materialTotal, laborTotal, settings.overheadPercent);
    const estTotals = composeTotals(requirements.totals.estimatedCost, laborEstTotal, settings.overheadPercent);

    const items = wos
      .map((wo) => {
        const labor = laborMap.get(wo.id) ?? { seconds: 0, cost: 0, entries: 0 };
        const material = materialByWo.get(wo.id) ?? 0;
        return {
          workOrderId: wo.id,
          orderNumber: wo.orderNumber,
          mark: wo.assemblyNode?.mark || wo.assemblyNode?.name || wo.orderNumber,
          status: String(wo.status),
          laborSeconds: labor.seconds,
          laborHours: round2(labor.seconds / 3600),
          laborCost: labor.cost,
          materialCost: material,
          totalCost: round2(labor.cost + material),
        };
      })
      .sort((a, b) => b.totalCost - a.totalCost || a.mark.localeCompare(b.mark, undefined, { numeric: true }));
    const attributedMaterial = round2(items.reduce((s, i) => s + i.materialCost, 0));

    return {
      orderId,
      number: order.number,
      customerName: order.customerName,
      quantity: order.quantity,
      status: String(order.status),
      projectId: order.projectId,
      currency: settings.currency,
      settings,
      ratesConfigured: rates,
      actual: {
        ...totals,
        laborSeconds,
        laborHours: round2(laborSeconds / 3600),
      },
      estimate: {
        ...estTotals,
        laborSeconds: laborEstSeconds,
        laborHours: round2(laborEstSeconds / 3600),
        materialUnmappedLines: requirements.totals.unmappedLines,
        materialUnpricedNote: requirements.totals.estimatedCost <= 0 && requirements.totals.lines > 0,
      },
      variance: {
        material: variance(totals.materialCost, estTotals.materialCost),
        labor: variance(totals.laborCost, estTotals.laborCost),
        total: variance(totals.totalCost, estTotals.totalCost),
      },
      items,
      materials: materialDetail,
      unattributedMaterialCost: round2(Math.max(0, totals.materialCost - attributedMaterial)),
    };
  }

  // ── Project (across all its orders) ────────────────────────────────────────

  async projectCost(projectId: string) {
    const org = this.org;
    const project = await this.projectRepo.findOne({ where: { id: projectId, organizationId: org } as any });
    if (!project) throw new NotFoundException('Project not found');
    const settings = await this.getSettings();

    const orders = await this.orderRepo.find({ where: { projectId, organizationId: org } as any, order: { createdAt: 'DESC' } });
    if (!orders.length) {
      const empty = composeTotals(0, 0, settings.overheadPercent);
      return {
        projectId, name: project.name, currency: settings.currency, settings,
        actual: empty, estimate: empty, orders: [],
      };
    }

    const [laborRows, materialMap, perUnit] = await Promise.all([
      this.woRepo.query(
        `SELECT w.production_order_id AS oid,
                COALESCE(SUM(GREATEST(COALESCE(te.duration_seconds,0) - COALESCE(te.break_seconds,0), 0)), 0)::bigint AS seconds,
                COALESCE(SUM(
                  GREATEST(COALESCE(te.duration_seconds,0) - COALESCE(te.break_seconds,0), 0) / 3600.0
                  * COALESCE(NULLIF(u.hourly_rate, 0), NULLIF(st.hourly_rate, 0), $2)
                ), 0) AS cost
           FROM time_entries te
           JOIN work_order_stages s ON s.id = te.work_order_stage_id
           JOIN work_orders w ON w.id = s.work_order_id
           LEFT JOIN stages st ON st.id = s.stage_id
           LEFT JOIN users u ON u.id = te.user_id
          WHERE te.organization_id = $1 AND w.production_order_id = ANY($3)
          GROUP BY w.production_order_id`,
        [org, settings.defaultLaborRate, orders.map((o) => o.id)],
      ),
      this.materialByKey('production_order_id', 'mv.organization_id = $1 AND mv.production_order_id = ANY($2)', [org, orders.map((o) => o.id)]),
      this.requirements.projectRequirements(projectId),
    ]);
    const laborByOrder = new Map<string, { seconds: number; cost: number }>(
      (laborRows as any[]).map((r) => [r.oid, { seconds: Number(r.seconds), cost: round2(Number(r.cost)) }]),
    );

    const orderRows = orders.map((o) => {
      const labor = laborByOrder.get(o.id) ?? { seconds: 0, cost: 0 };
      const material = materialMap.get(o.id) ?? 0;
      const totals = composeTotals(material, labor.cost, settings.overheadPercent);
      const estMaterial = round2(perUnit.totals.estimatedCost * (o.quantity ?? 1));
      return {
        orderId: o.id,
        number: o.number,
        customerName: o.customerName,
        quantity: o.quantity,
        status: String(o.status),
        laborHours: round2(labor.seconds / 3600),
        ...totals,
        estimatedMaterialCost: estMaterial,
      };
    });

    const actual = composeTotals(
      orderRows.reduce((s, r) => s + r.materialCost, 0),
      orderRows.reduce((s, r) => s + r.laborCost, 0),
      settings.overheadPercent,
    );
    return {
      projectId,
      name: project.name,
      projectNumber: (project as any).projectNumber ?? null,
      currency: settings.currency,
      settings,
      perUnitMaterialEstimate: perUnit.totals.estimatedCost,
      actual,
      orders: orderRows,
    };
  }

  /** Org-wide cost overview: every production order with its cost roll-up (the /costing page). */
  async ordersOverview() {
    const org = this.org;
    const settings = await this.getSettings();
    const orders: any[] = await this.orderRepo.query(
      `SELECT o.id, o.number, o.customer_name, o.quantity, o.status, o.created_at,
              p.id AS project_id, p.name AS project_name
         FROM production_orders o
         JOIN projects p ON p.id = o.project_id
        WHERE o.organization_id = $1
        ORDER BY o.created_at DESC
        LIMIT 200`,
      [org],
    );
    if (!orders.length) return { currency: settings.currency, settings, kpis: { orders: 0, laborCost: 0, materialCost: 0, totalCost: 0 }, orders: [] };

    const ids = orders.map((o) => o.id);
    const [laborRows, materialMap] = await Promise.all([
      this.orderRepo.query(
        `SELECT w.production_order_id AS oid,
                COALESCE(SUM(GREATEST(COALESCE(te.duration_seconds,0) - COALESCE(te.break_seconds,0), 0)), 0)::bigint AS seconds,
                COALESCE(SUM(
                  GREATEST(COALESCE(te.duration_seconds,0) - COALESCE(te.break_seconds,0), 0) / 3600.0
                  * COALESCE(NULLIF(u.hourly_rate, 0), NULLIF(st.hourly_rate, 0), $2)
                ), 0) AS cost
           FROM time_entries te
           JOIN work_order_stages s ON s.id = te.work_order_stage_id
           JOIN work_orders w ON w.id = s.work_order_id
           LEFT JOIN stages st ON st.id = s.stage_id
           LEFT JOIN users u ON u.id = te.user_id
          WHERE te.organization_id = $1 AND w.production_order_id = ANY($3)
          GROUP BY w.production_order_id`,
        [org, settings.defaultLaborRate, ids],
      ),
      this.materialByKey('production_order_id', 'mv.organization_id = $1 AND mv.production_order_id = ANY($2)', [org, ids]),
    ]);
    const laborByOrder = new Map<string, { seconds: number; cost: number }>(
      (laborRows as any[]).map((r) => [r.oid, { seconds: Number(r.seconds), cost: round2(Number(r.cost)) }]),
    );

    const rows = orders.map((o) => {
      const labor = laborByOrder.get(o.id) ?? { seconds: 0, cost: 0 };
      const material = materialMap.get(o.id) ?? 0;
      const totals = composeTotals(material, labor.cost, settings.overheadPercent);
      return {
        orderId: o.id,
        number: o.number,
        customerName: o.customer_name,
        quantity: Number(o.quantity),
        status: o.status,
        createdAt: o.created_at,
        project: { id: o.project_id, name: o.project_name },
        laborHours: round2(labor.seconds / 3600),
        ...totals,
      };
    });
    return {
      currency: settings.currency,
      settings,
      kpis: {
        orders: rows.length,
        laborCost: round2(rows.reduce((s, r) => s + r.laborCost, 0)),
        materialCost: round2(rows.reduce((s, r) => s + r.materialCost, 0)),
        overheadCost: round2(rows.reduce((s, r) => s + r.overheadCost, 0)),
        totalCost: round2(rows.reduce((s, r) => s + r.totalCost, 0)),
      },
      orders: rows,
    };
  }
}
