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
  CostingSettings, normalizeSettings, composeTotals, variance, round2, allocateProportionally,
} from './costing-math.js';
import { UpdateCostingSettingsDto } from './costing.dto.js';

export interface LaborBucket { seconds: number; cost: number; }
/** Clocked-labor aggregate for one work order (from time_entries). */
export interface LaborAgg {
  seconds: number;
  cost: number;
  entries: number;
  rework: LaborBucket;
  setup: LaborBucket;
  idle: LaborBucket;
}
const EMPTY_LABOR: LaborAgg = {
  seconds: 0, cost: 0, entries: 0,
  rework: { seconds: 0, cost: 0 }, setup: { seconds: 0, cost: 0 }, idle: { seconds: 0, cost: 0 },
};

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
   * Clocked labor grouped by work order: paid seconds + cost with the rate
   * resolved PER ENTRY (STAMPED labor_rate → worker → stage → default — the
   * stamped rate wins so a later rate change never rewrites history), plus the
   * setup / rework / idle split (productive = total − setup − rework).
   */
  private async laborByWorkOrder(filterSql: string, params: any[], defaultRate: number): Promise<Map<string, LaborAgg>> {
    const paid = `GREATEST(COALESCE(te.duration_seconds, 0) - COALESCE(te.break_seconds, 0), 0)`;
    const rate = `COALESCE(NULLIF(te.labor_rate, 0), NULLIF(u.hourly_rate, 0), NULLIF(st.hourly_rate, 0), $${params.length + 1})`;
    const rows: any[] = await this.woRepo.query(
      `SELECT s.work_order_id AS wo_id,
              COALESCE(SUM(${paid}), 0)::bigint AS seconds,
              COALESCE(SUM(${paid} / 3600.0 * ${rate}), 0) AS cost,
              COUNT(te.id)::int AS entries,
              COALESCE(SUM(CASE WHEN te.is_rework THEN ${paid} ELSE 0 END), 0)::bigint AS rework_seconds,
              COALESCE(SUM(CASE WHEN te.is_rework THEN ${paid} / 3600.0 * ${rate} ELSE 0 END), 0) AS rework_cost,
              COALESCE(SUM(CASE WHEN te.is_setup AND NOT te.is_rework THEN ${paid} ELSE 0 END), 0)::bigint AS setup_seconds,
              COALESCE(SUM(CASE WHEN te.is_setup AND NOT te.is_rework THEN ${paid} / 3600.0 * ${rate} ELSE 0 END), 0) AS setup_cost,
              COALESCE(SUM(COALESCE(te.idle_seconds, 0)), 0)::bigint AS idle_seconds,
              COALESCE(SUM(COALESCE(te.idle_seconds, 0) / 3600.0 * ${rate}), 0) AS idle_cost
         FROM time_entries te
         JOIN work_order_stages s ON s.id = te.work_order_stage_id
         JOIN work_orders w ON w.id = s.work_order_id
         LEFT JOIN stages st ON st.id = s.stage_id
         LEFT JOIN users u ON u.id = te.user_id
        WHERE ${filterSql}
        GROUP BY s.work_order_id`,
      [...params, defaultRate],
    );
    return new Map(rows.map((r) => [r.wo_id, {
      seconds: Number(r.seconds),
      cost: round2(Number(r.cost)),
      entries: Number(r.entries),
      rework: { seconds: Number(r.rework_seconds), cost: round2(Number(r.rework_cost)) },
      setup: { seconds: Number(r.setup_seconds), cost: round2(Number(r.setup_cost)) },
      idle: { seconds: Number(r.idle_seconds), cost: round2(Number(r.idle_cost)) },
    }]));
  }

  /**
   * EARNED-STANDARD labor + machine proxy grouped by `keyExpr`, for stages that
   * are in-progress/completed but have NO time entries (work driven purely from
   * the order board / kanban records counts, not clock-in/out — without this
   * they would read $0). Labor = stage target × units DONE × (stage rate |
   * default); machine = stage machine time × units DONE × stage machine rate.
   * Flagged as estimated in the response so actual-vs-estimate stays honest.
   */
  private async proxyByKey(
    keyExpr: 's.work_order_id' | 'w.production_order_id',
    filterSql: string,
    params: any[],
    defaultRate: number,
    orgOverheadPct: number,
  ): Promise<Map<string, { seconds: number; cost: number; machineSeconds: number; machineCost: number; overhead: number; stages: number }>> {
    const rate = `COALESCE(NULLIF(st.hourly_rate, 0), $${params.length + 1})`;
    const laborSec = `COALESCE(st.target_time_seconds, 0) * COALESCE(s.qty_done, 0)`;
    const ohPct = `COALESCE(st.overhead_percent, $${params.length + 2})`;
    const rows: any[] = await this.woRepo.query(
      `SELECT ${keyExpr} AS key,
              COALESCE(SUM(${laborSec}), 0)::bigint AS seconds,
              COALESCE(SUM(${laborSec} / 3600.0 * ${rate}), 0) AS cost,
              COALESCE(SUM(CASE WHEN COALESCE(st.machine_rate, 0) > 0
                THEN COALESCE(st.machine_time_seconds, 0) * COALESCE(s.qty_done, 0) ELSE 0 END), 0)::bigint AS machine_seconds,
              COALESCE(SUM(
                COALESCE(st.machine_time_seconds, 0) * COALESCE(s.qty_done, 0) / 3600.0
                * COALESCE(NULLIF(st.machine_rate, 0), 0)
              ), 0) AS machine_cost,
              COALESCE(SUM(${laborSec} / 3600.0 * ${rate} * ${ohPct} / 100.0), 0) AS overhead,
              COUNT(*)::int AS stages
         FROM work_order_stages s
         JOIN work_orders w ON w.id = s.work_order_id
         LEFT JOIN stages st ON st.id = s.stage_id
        WHERE s.status IN ('in_progress', 'completed')
          AND NOT EXISTS (SELECT 1 FROM time_entries te WHERE te.work_order_stage_id = s.id)
          AND ${filterSql}
        GROUP BY ${keyExpr}`,
      [...params, defaultRate, orgOverheadPct],
    );
    return new Map(rows.map((r) => [r.key, {
      seconds: Number(r.seconds), cost: round2(Number(r.cost)),
      machineSeconds: Number(r.machine_seconds), machineCost: round2(Number(r.machine_cost)),
      overhead: round2(Number(r.overhead)),
      stages: Number(r.stages),
    }]));
  }

  /**
   * Clocked OVERHEAD grouped by `keyExpr`: each clocked entry's labor cost ×ITS
   * stage's overhead % (`stages.overhead_percent` → org default), so welding
   * burden ≠ painting burden. Summed = the actual overhead on clocked labor (the
   * proxy carries its own; estimate overhead comes from the estimate query).
   */
  private async overheadByKey(
    keyExpr: 's.work_order_id' | 'w.production_order_id',
    filterSql: string,
    params: any[],
    defaultRate: number,
    orgOverheadPct: number,
  ): Promise<Map<string, number>> {
    const paid = `GREATEST(COALESCE(te.duration_seconds, 0) - COALESCE(te.break_seconds, 0), 0)`;
    const rate = `COALESCE(NULLIF(te.labor_rate, 0), NULLIF(u.hourly_rate, 0), NULLIF(st.hourly_rate, 0), $${params.length + 1})`;
    const ohPct = `COALESCE(st.overhead_percent, $${params.length + 2})`;
    const rows: any[] = await this.woRepo.query(
      `SELECT ${keyExpr} AS key,
              COALESCE(SUM(${paid} / 3600.0 * ${rate} * ${ohPct} / 100.0), 0) AS overhead
         FROM time_entries te
         JOIN work_order_stages s ON s.id = te.work_order_stage_id
         JOIN work_orders w ON w.id = s.work_order_id
         LEFT JOIN stages st ON st.id = s.stage_id
         LEFT JOIN users u ON u.id = te.user_id
        WHERE ${filterSql}
        GROUP BY ${keyExpr}`,
      [...params, defaultRate, orgOverheadPct],
    );
    return new Map(rows.map((r) => [r.key, round2(Number(r.overhead))]));
  }

  /**
   * Clocked MACHINE cost grouped by `keyExpr`: attended station seconds × the
   * machine/work-center rate — STAMPED time_entries.machine_rate wins, else the
   * station's live rate. Only entries at a rated station contribute; machine
   * seconds count just that charged time.
   */
  private async machineByKey(keyExpr: 's.work_order_id' | 'w.production_order_id', filterSql: string, params: any[]): Promise<Map<string, { seconds: number; cost: number }>> {
    const paid = `GREATEST(COALESCE(te.duration_seconds, 0) - COALESCE(te.break_seconds, 0), 0)`;
    const mrate = `COALESCE(NULLIF(te.machine_rate, 0), NULLIF(stn.machine_rate, 0), 0)`;
    const rows: any[] = await this.woRepo.query(
      `SELECT ${keyExpr} AS key,
              COALESCE(SUM(CASE WHEN ${mrate} > 0 THEN ${paid} ELSE 0 END), 0)::bigint AS seconds,
              COALESCE(SUM(${paid} / 3600.0 * ${mrate}), 0) AS cost
         FROM time_entries te
         JOIN work_order_stages s ON s.id = te.work_order_stage_id
         JOIN work_orders w ON w.id = s.work_order_id
         LEFT JOIN stations stn ON stn.id = te.station_id
        WHERE ${filterSql}
        GROUP BY ${keyExpr}`,
      params,
    );
    return new Map(rows.map((r) => [r.key, { seconds: Number(r.seconds), cost: round2(Number(r.cost)) }]));
  }

  /** Machine ESTIMATE grouped by work order: stage machine time × planned units × stage machine rate. */
  private async machineEstimateByWorkOrder(filterSql: string, params: any[]): Promise<Map<string, { seconds: number; cost: number }>> {
    const rows: any[] = await this.woRepo.query(
      `SELECT s.work_order_id AS wo_id,
              COALESCE(SUM(CASE WHEN COALESCE(st.machine_rate, 0) > 0
                THEN COALESCE(st.machine_time_seconds, 0) * COALESCE(s.qty_total, 0) ELSE 0 END), 0)::bigint AS seconds,
              COALESCE(SUM(
                COALESCE(st.machine_time_seconds, 0) * COALESCE(s.qty_total, 0) / 3600.0
                * COALESCE(NULLIF(st.machine_rate, 0), 0)
              ), 0) AS cost
         FROM work_order_stages s
         JOIN work_orders w ON w.id = s.work_order_id
         LEFT JOIN stages st ON st.id = s.stage_id
        WHERE s.status <> 'skipped' AND ${filterSql}
        GROUP BY s.work_order_id`,
      params,
    );
    return new Map(rows.map((r) => [r.wo_id, { seconds: Number(r.seconds), cost: round2(Number(r.cost)) }]));
  }

  /** Labor ESTIMATE grouped by work order: stage target × planned units × (stage rate | default), + per-stage overhead. */
  private async laborEstimateByWorkOrder(filterSql: string, params: any[], defaultRate: number, orgOverheadPct: number): Promise<Map<string, { seconds: number; cost: number; overhead: number }>> {
    const rate = `COALESCE(NULLIF(st.hourly_rate, 0), $${params.length + 1})`;
    const sec = `COALESCE(st.target_time_seconds, 0) * COALESCE(s.qty_total, 0)`;
    const ohPct = `COALESCE(st.overhead_percent, $${params.length + 2})`;
    const rows: { wo_id: string; seconds: string; cost: string; overhead: string }[] = await this.woRepo.query(
      `SELECT s.work_order_id AS wo_id,
              COALESCE(SUM(${sec}), 0)::bigint AS seconds,
              COALESCE(SUM(${sec} / 3600.0 * ${rate}), 0) AS cost,
              COALESCE(SUM(${sec} / 3600.0 * ${rate} * ${ohPct} / 100.0), 0) AS overhead
         FROM work_order_stages s
         JOIN work_orders w ON w.id = s.work_order_id
         LEFT JOIN stages st ON st.id = s.stage_id
        WHERE s.status <> 'skipped' AND ${filterSql}
        GROUP BY s.work_order_id`,
      [...params, defaultRate, orgOverheadPct],
    );
    return new Map(rows.map((r) => [r.wo_id, { seconds: Number(r.seconds), cost: round2(Number(r.cost)), overhead: round2(Number(r.overhead)) }]));
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

  /**
   * Per-WO material picture for one order: directly-PINNED consumption
   * (`stock_movements.work_order_id`) plus an ALLOCATED share of the order-level
   * "bulk" issues that weren't pinned to any assembly — spread across the work
   * orders in proportion to their BOM material estimate (→ subtree weight →
   * equal, when no priced BOM exists). Lets a per-WO cost include its fair share
   * of stock issued loosely to the order, without changing the order's headline
   * material total (the bulk is redistributed, not invented).
   */
  private async materialAllocation(
    order: { id: string; projectId: string; quantity: number | null },
    wos: { id: string; assemblyNodeId: string | null }[],
    pinnedMap: Map<string, number>,
    total: number,
  ): Promise<{ byWo: Map<string, { pinned: number; allocated: number; estimate: number }>; unattributed: number; allocatedTotal: number }> {
    const est = await this.requirements.bomEstimateByNode(order.projectId, wos.map((w) => w.assemblyNodeId), order.quantity ?? 1);
    const woIds = wos.map((w) => w.id);
    const pinned = woIds.map((id) => pinnedMap.get(id) ?? 0);
    const sumPinned = round2(pinned.reduce((s, v) => s + v, 0));
    const unattributed = round2(Math.max(0, total - sumPinned));
    const estByWo = wos.map((w) => (w.assemblyNodeId ? est.get(w.assemblyNodeId)?.estimatedCost ?? 0 : 0));
    const wtByWo = wos.map((w) => (w.assemblyNodeId ? est.get(w.assemblyNodeId)?.weightKg ?? 0 : 0));
    const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
    let basis = estByWo;
    if (sum(basis) <= 0) basis = wtByWo;            // no priced BOM → split by subtree weight
    if (sum(basis) <= 0) basis = woIds.map(() => 1); // nothing to go on → split equally
    const allocated = allocateProportionally(unattributed, basis);
    const byWo = new Map<string, { pinned: number; allocated: number; estimate: number }>();
    woIds.forEach((id, i) => byWo.set(id, { pinned: pinned[i], allocated: allocated[i], estimate: round2(estByWo[i]) }));
    return { byWo, unattributed, allocatedTotal: round2(sum(allocated)) };
  }

  // ── Per-assembly work order ────────────────────────────────────────────────

  async workOrderCost(workOrderId: string) {
    const org = this.org;
    const wo = await this.woRepo.findOne({ where: { id: workOrderId, organizationId: org } as any, relations: ['assemblyNode'] });
    if (!wo) throw new NotFoundException('Work order not found');
    const settings = await this.getSettings();

    const [laborMap, proxyMap, laborEstMap, machineMap, machineEstMap, overheadMap, materialMap, materials, workers] = await Promise.all([
      this.laborByWorkOrder('te.organization_id = $1 AND s.work_order_id = $2', [org, workOrderId], settings.defaultLaborRate),
      this.proxyByKey('s.work_order_id', 's.organization_id = $1 AND s.work_order_id = $2', [org, workOrderId], settings.defaultLaborRate, settings.overheadPercent),
      this.laborEstimateByWorkOrder('s.organization_id = $1 AND s.work_order_id = $2', [org, workOrderId], settings.defaultLaborRate, settings.overheadPercent),
      this.machineByKey('s.work_order_id', 'te.organization_id = $1 AND s.work_order_id = $2', [org, workOrderId]),
      this.machineEstimateByWorkOrder('s.organization_id = $1 AND s.work_order_id = $2', [org, workOrderId]),
      this.overheadByKey('s.work_order_id', 'te.organization_id = $1 AND s.work_order_id = $2', [org, workOrderId], settings.defaultLaborRate, settings.overheadPercent),
      this.materialByKey('work_order_id', 'mv.organization_id = $1 AND mv.work_order_id = $2', [org, workOrderId]),
      this.materialDetail('mv.organization_id = $1 AND mv.work_order_id = $2', [org, workOrderId]),
      this.woRepo.query(
        `SELECT u.id, u.first_name, u.last_name,
                COALESCE(SUM(GREATEST(COALESCE(te.duration_seconds,0) - COALESCE(te.break_seconds,0), 0)), 0)::bigint AS seconds,
                COALESCE(SUM(
                  GREATEST(COALESCE(te.duration_seconds,0) - COALESCE(te.break_seconds,0), 0) / 3600.0
                  * COALESCE(NULLIF(te.labor_rate, 0), NULLIF(u.hourly_rate, 0), NULLIF(st.hourly_rate, 0), $3)
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

    const clocked = laborMap.get(workOrderId) ?? EMPTY_LABOR;
    const proxy = proxyMap.get(workOrderId) ?? { seconds: 0, cost: 0, machineSeconds: 0, machineCost: 0, overhead: 0, stages: 0 };
    const laborEst = laborEstMap.get(workOrderId) ?? { seconds: 0, cost: 0, overhead: 0 };
    const machineClocked = machineMap.get(workOrderId) ?? { seconds: 0, cost: 0 };
    const machineEst = machineEstMap.get(workOrderId) ?? { seconds: 0, cost: 0 };
    const laborSeconds = clocked.seconds + proxy.seconds;
    const laborCostTotal = round2(clocked.cost + proxy.cost);
    const machineSeconds = machineClocked.seconds + proxy.machineSeconds;
    const machineCostTotal = round2(machineClocked.cost + proxy.machineCost);
    // Overhead = per-stage % on labor (clocked + proxy); estimate uses the same per-stage %.
    const overheadActual = round2((overheadMap.get(workOrderId) ?? 0) + proxy.overhead);
    const overheadEstimate = laborEst.overhead;
    // Productive = clocked total − setup − rework (idle is an overlay memo, not a separate slice).
    const productive = {
      seconds: Math.max(0, clocked.seconds - clocked.setup.seconds - clocked.rework.seconds),
      cost: round2(Math.max(0, clocked.cost - clocked.setup.cost - clocked.rework.cost)),
    };
    // Material: directly-pinned + an allocated share of the order's bulk issues,
    // with this assembly's own BOM estimate (loaded = pinned + allocated).
    let materialPinned = materialMap.get(workOrderId) ?? 0;
    let materialAllocated = 0;
    let materialEstimate = 0;
    if (wo.productionOrderId) {
      const order = await this.orderRepo.findOne({ where: { id: wo.productionOrderId, organizationId: org } as any });
      if (order) {
        const siblings = await this.woRepo.find({ where: { productionOrderId: wo.productionOrderId, organizationId: org } as any, select: ['id', 'assemblyNodeId'] as any });
        const [pinnedMap, totalMap] = await Promise.all([
          this.materialByKey('work_order_id', 'mv.organization_id = $1 AND mv.production_order_id = $2', [org, wo.productionOrderId]),
          this.materialByKey('production_order_id', 'mv.organization_id = $1 AND mv.production_order_id = $2', [org, wo.productionOrderId]),
        ]);
        const alloc = await this.materialAllocation(order, siblings as any, pinnedMap, totalMap.get(wo.productionOrderId) ?? 0);
        const mine = alloc.byWo.get(workOrderId);
        if (mine) { materialPinned = mine.pinned; materialAllocated = mine.allocated; materialEstimate = mine.estimate; }
      }
    } else if (wo.assemblyNodeId && wo.assemblyNode) {
      const est = await this.requirements.bomEstimateByNode(wo.assemblyNode.projectId, [wo.assemblyNodeId], wo.quantity ?? 1);
      materialEstimate = est.get(wo.assemblyNodeId)?.estimatedCost ?? 0;
    }
    const materialLoaded = round2(materialPinned + materialAllocated);
    const totals = composeTotals(materialLoaded, laborCostTotal, settings.overheadPercent, machineCostTotal, overheadActual);
    const estTotals = composeTotals(materialEstimate, laborEst.cost, settings.overheadPercent, machineEst.cost, overheadEstimate);

    return {
      workOrderId,
      orderNumber: wo.orderNumber,
      productionOrderId: wo.productionOrderId,
      mark: wo.assemblyNode?.mark || wo.assemblyNode?.name || wo.orderNumber,
      currency: settings.currency,
      settings,
      labor: {
        seconds: laborSeconds,
        hours: round2(laborSeconds / 3600),
        cost: laborCostTotal,
        entries: clocked.entries,
        // Clocked (from time_entries, rate stamped at clock-out) vs proxy
        // (earned-standard for board-recorded stages with no clocked time).
        clocked: { seconds: clocked.seconds, hours: round2(clocked.seconds / 3600), cost: clocked.cost, entries: clocked.entries },
        proxy: { seconds: proxy.seconds, hours: round2(proxy.seconds / 3600), cost: proxy.cost, stages: proxy.stages },
        // Split of clocked labor (cost of quality = rework; setup = batch fixed cost; idle = paid-but-waiting memo).
        split: { productive, setup: clocked.setup, rework: clocked.rework, idle: clocked.idle },
        estimatedSeconds: laborEst.seconds,
        estimatedHours: round2(laborEst.seconds / 3600),
        estimatedCost: laborEst.cost,
        variance: variance(laborCostTotal, laborEst.cost),
      },
      machine: {
        seconds: machineSeconds,
        hours: round2(machineSeconds / 3600),
        cost: machineCostTotal,
        clocked: { seconds: machineClocked.seconds, hours: round2(machineClocked.seconds / 3600), cost: machineClocked.cost },
        proxy: { seconds: proxy.machineSeconds, hours: round2(proxy.machineSeconds / 3600), cost: proxy.machineCost },
        estimatedSeconds: machineEst.seconds,
        estimatedHours: round2(machineEst.seconds / 3600),
        estimatedCost: machineEst.cost,
        variance: variance(machineCostTotal, machineEst.cost),
      },
      material: {
        cost: totals.materialCost,            // loaded = pinned + allocated
        pinnedCost: round2(materialPinned),    // issued directly to this WO
        allocatedCost: round2(materialAllocated), // share of order-level bulk issues
        estimatedCost: materialEstimate,       // this assembly's BOM × order qty
        variance: variance(totals.materialCost, materialEstimate),
        items: materials,
      },
      overhead: { percent: settings.overheadPercent, cost: totals.overheadCost },
      totalCost: totals.totalCost,
      estimatedTotalCost: estTotals.totalCost,
      estimatedLaborPlusOverhead: estTotals.totalCost,
      workers: [
        ...(workers as any[]).map((w) => ({
          id: w.id,
          name: [w.first_name, w.last_name].filter(Boolean).join(' ') || 'Unknown',
          seconds: Number(w.seconds),
          hours: round2(Number(w.seconds) / 3600),
          cost: round2(Number(w.cost)),
        })),
        // Board-recorded work with no clocked operator — keeps the per-worker
        // breakdown summing to the headline labor cost.
        ...(proxy.cost > 0 ? [{
          id: null,
          name: 'Board-recorded (no clocked time)',
          seconds: proxy.seconds,
          hours: round2(proxy.seconds / 3600),
          cost: proxy.cost,
          estimated: true,
        }] : []),
      ],
    };
  }

  // ── Production order ───────────────────────────────────────────────────────

  async orderCost(orderId: string) {
    const org = this.org;
    const order = await this.orderRepo.findOne({ where: { id: orderId, organizationId: org } as any });
    if (!order) throw new NotFoundException('Production order not found');
    const settings = await this.getSettings();

    const wos = await this.woRepo.find({ where: { productionOrderId: orderId, organizationId: org } as any, relations: ['assemblyNode'] });
    const [laborMap, proxyMap, laborEstMap, machineMap, machineEstMap, overheadMap, materialByWo, materialDetail, rates, requirements] = await Promise.all([
      this.laborByWorkOrder('te.organization_id = $1 AND w.production_order_id = $2', [org, orderId], settings.defaultLaborRate),
      this.proxyByKey('s.work_order_id', 's.organization_id = $1 AND w.production_order_id = $2', [org, orderId], settings.defaultLaborRate, settings.overheadPercent),
      this.laborEstimateByWorkOrder('s.organization_id = $1 AND w.production_order_id = $2', [org, orderId], settings.defaultLaborRate, settings.overheadPercent),
      this.machineByKey('s.work_order_id', 'te.organization_id = $1 AND w.production_order_id = $2', [org, orderId]),
      this.machineEstimateByWorkOrder('s.organization_id = $1 AND w.production_order_id = $2', [org, orderId]),
      this.overheadByKey('s.work_order_id', 'te.organization_id = $1 AND w.production_order_id = $2', [org, orderId], settings.defaultLaborRate, settings.overheadPercent),
      this.materialByKey('work_order_id', 'mv.organization_id = $1 AND mv.production_order_id = $2', [org, orderId]),
      this.materialDetail('mv.organization_id = $1 AND mv.production_order_id = $2', [org, orderId]),
      this.ratesConfigured(),
      this.requirements.orderRequirements(orderId),
    ]);

    // Per-WO labor + machine = clocked (time_entries) + earned-standard proxy (board-recorded stages with no clocked time).
    const woLabor = (id: string) => {
      const c = laborMap.get(id) ?? EMPTY_LABOR;
      const p = proxyMap.get(id) ?? { seconds: 0, cost: 0, machineSeconds: 0, machineCost: 0, overhead: 0, stages: 0 };
      return { seconds: c.seconds + p.seconds, cost: round2(c.cost + p.cost), entries: c.entries };
    };
    const woMachine = (id: string) => {
      const c = machineMap.get(id) ?? { seconds: 0, cost: 0 };
      const p = proxyMap.get(id) ?? { machineSeconds: 0, machineCost: 0 };
      return { seconds: c.seconds + p.machineSeconds, cost: round2(c.cost + p.machineCost) };
    };
    // Per-stage overhead per WO = clocked overhead + proxy overhead.
    const woOverhead = (id: string) => round2((overheadMap.get(id) ?? 0) + (proxyMap.get(id)?.overhead ?? 0));

    // Order-level material total comes from the ledger by production_order_id
    // (includes rows not pinned to a specific assembly's work order).
    const materialTotal = round2(materialDetail.reduce((s, m) => s + m.cost, 0));
    const woIds = wos.map((w) => w.id);
    // Pinned + allocated bulk material per WO (+ per-WO BOM estimate).
    const matAlloc = await this.materialAllocation(order, wos, materialByWo, materialTotal);
    const laborTotal = round2(woIds.reduce((s, id) => s + woLabor(id).cost, 0));
    const laborSeconds = woIds.reduce((s, id) => s + woLabor(id).seconds, 0);
    const machineTotal = round2(woIds.reduce((s, id) => s + woMachine(id).cost, 0));
    const machineSeconds = woIds.reduce((s, id) => s + woMachine(id).seconds, 0);
    const laborEstTotal = round2([...laborEstMap.values()].reduce((s, l) => s + l.cost, 0));
    const laborEstSeconds = [...laborEstMap.values()].reduce((s, l) => s + l.seconds, 0);
    const machineEstTotal = round2([...machineEstMap.values()].reduce((s, l) => s + l.cost, 0));
    const machineEstSeconds = [...machineEstMap.values()].reduce((s, l) => s + l.seconds, 0);
    const overheadActual = round2(woIds.reduce((s, id) => s + woOverhead(id), 0));
    const overheadEstimate = round2([...laborEstMap.values()].reduce((s, l) => s + l.overhead, 0));

    const totals = composeTotals(materialTotal, laborTotal, settings.overheadPercent, machineTotal, overheadActual);
    const estTotals = composeTotals(requirements.totals.estimatedCost, laborEstTotal, settings.overheadPercent, machineEstTotal, overheadEstimate);

    const items = wos
      .map((wo) => {
        const labor = woLabor(wo.id);
        const machine = woMachine(wo.id);
        const m = matAlloc.byWo.get(wo.id) ?? { pinned: 0, allocated: 0, estimate: 0 };
        return {
          workOrderId: wo.id,
          orderNumber: wo.orderNumber,
          mark: wo.assemblyNode?.mark || wo.assemblyNode?.name || wo.orderNumber,
          status: String(wo.status),
          laborSeconds: labor.seconds,
          laborHours: round2(labor.seconds / 3600),
          laborCost: labor.cost,
          machineHours: round2(machine.seconds / 3600),
          machineCost: machine.cost,
          materialCost: m.pinned,                 // directly pinned to this WO
          allocatedMaterialCost: m.allocated,     // share of order-level bulk issues
          estimatedMaterialCost: m.estimate,      // this assembly's BOM × order qty
          totalCost: round2(labor.cost + machine.cost + m.pinned + m.allocated),
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
        machineSeconds,
        machineHours: round2(machineSeconds / 3600),
      },
      estimate: {
        ...estTotals,
        laborSeconds: laborEstSeconds,
        laborHours: round2(laborEstSeconds / 3600),
        machineSeconds: machineEstSeconds,
        machineHours: round2(machineEstSeconds / 3600),
        materialUnmappedLines: requirements.totals.unmappedLines,
        materialUnpricedNote: requirements.totals.estimatedCost <= 0 && requirements.totals.lines > 0,
      },
      variance: {
        material: variance(totals.materialCost, estTotals.materialCost),
        labor: variance(totals.laborCost, estTotals.laborCost),
        machine: variance(totals.machineCost, estTotals.machineCost),
        total: variance(totals.totalCost, estTotals.totalCost),
      },
      items,
      materials: materialDetail,
      unattributedMaterialCost: round2(Math.max(0, totals.materialCost - attributedMaterial)),
      // Of the unattributed bulk, how much was spread across the WOs above
      // (items[].allocatedMaterialCost). The remainder (if any) stays unallocated.
      allocatedMaterialTotal: matAlloc.allocatedTotal,
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

    const orderIds = orders.map((o) => o.id);
    const [laborRows, proxyMap, machineMap, overheadMap, materialMap, perUnit] = await Promise.all([
      this.woRepo.query(
        `SELECT w.production_order_id AS oid,
                COALESCE(SUM(GREATEST(COALESCE(te.duration_seconds,0) - COALESCE(te.break_seconds,0), 0)), 0)::bigint AS seconds,
                COALESCE(SUM(
                  GREATEST(COALESCE(te.duration_seconds,0) - COALESCE(te.break_seconds,0), 0) / 3600.0
                  * COALESCE(NULLIF(te.labor_rate, 0), NULLIF(u.hourly_rate, 0), NULLIF(st.hourly_rate, 0), $2)
                ), 0) AS cost
           FROM time_entries te
           JOIN work_order_stages s ON s.id = te.work_order_stage_id
           JOIN work_orders w ON w.id = s.work_order_id
           LEFT JOIN stages st ON st.id = s.stage_id
           LEFT JOIN users u ON u.id = te.user_id
          WHERE te.organization_id = $1 AND w.production_order_id = ANY($3)
          GROUP BY w.production_order_id`,
        [org, settings.defaultLaborRate, orderIds],
      ),
      this.proxyByKey('w.production_order_id', 's.organization_id = $1 AND w.production_order_id = ANY($2)', [org, orderIds], settings.defaultLaborRate, settings.overheadPercent),
      this.machineByKey('w.production_order_id', 'te.organization_id = $1 AND w.production_order_id = ANY($2)', [org, orderIds]),
      this.overheadByKey('w.production_order_id', 'te.organization_id = $1 AND w.production_order_id = ANY($2)', [org, orderIds], settings.defaultLaborRate, settings.overheadPercent),
      this.materialByKey('production_order_id', 'mv.organization_id = $1 AND mv.production_order_id = ANY($2)', [org, orderIds]),
      this.requirements.projectRequirements(projectId),
    ]);
    const laborByOrder = new Map<string, { seconds: number; cost: number }>(
      (laborRows as any[]).map((r) => [r.oid, { seconds: Number(r.seconds), cost: round2(Number(r.cost)) }]),
    );

    const orderRows = orders.map((o) => {
      const clk = laborByOrder.get(o.id) ?? { seconds: 0, cost: 0 };
      const px = proxyMap.get(o.id) ?? { seconds: 0, cost: 0, machineSeconds: 0, machineCost: 0, overhead: 0, stages: 0 };
      const mc = machineMap.get(o.id) ?? { seconds: 0, cost: 0 };
      const labor = { seconds: clk.seconds + px.seconds, cost: round2(clk.cost + px.cost) };
      const machine = { seconds: mc.seconds + px.machineSeconds, cost: round2(mc.cost + px.machineCost) };
      const material = materialMap.get(o.id) ?? 0;
      const overhead = round2((overheadMap.get(o.id) ?? 0) + px.overhead);
      const totals = composeTotals(material, labor.cost, settings.overheadPercent, machine.cost, overhead);
      const estMaterial = round2(perUnit.totals.estimatedCost * (o.quantity ?? 1));
      return {
        orderId: o.id,
        number: o.number,
        customerName: o.customerName,
        quantity: o.quantity,
        status: String(o.status),
        laborHours: round2(labor.seconds / 3600),
        machineHours: round2(machine.seconds / 3600),
        ...totals,
        estimatedMaterialCost: estMaterial,
      };
    });

    const actual = composeTotals(
      orderRows.reduce((s, r) => s + r.materialCost, 0),
      orderRows.reduce((s, r) => s + r.laborCost, 0),
      settings.overheadPercent,
      orderRows.reduce((s, r) => s + r.machineCost, 0),
      round2(orderRows.reduce((s, r) => s + r.overheadCost, 0)),
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
    const [laborRows, proxyMap, machineMap, overheadMap, materialMap] = await Promise.all([
      this.orderRepo.query(
        `SELECT w.production_order_id AS oid,
                COALESCE(SUM(GREATEST(COALESCE(te.duration_seconds,0) - COALESCE(te.break_seconds,0), 0)), 0)::bigint AS seconds,
                COALESCE(SUM(
                  GREATEST(COALESCE(te.duration_seconds,0) - COALESCE(te.break_seconds,0), 0) / 3600.0
                  * COALESCE(NULLIF(te.labor_rate, 0), NULLIF(u.hourly_rate, 0), NULLIF(st.hourly_rate, 0), $2)
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
      this.proxyByKey('w.production_order_id', 's.organization_id = $1 AND w.production_order_id = ANY($2)', [org, ids], settings.defaultLaborRate, settings.overheadPercent),
      this.machineByKey('w.production_order_id', 'te.organization_id = $1 AND w.production_order_id = ANY($2)', [org, ids]),
      this.overheadByKey('w.production_order_id', 'te.organization_id = $1 AND w.production_order_id = ANY($2)', [org, ids], settings.defaultLaborRate, settings.overheadPercent),
      this.materialByKey('production_order_id', 'mv.organization_id = $1 AND mv.production_order_id = ANY($2)', [org, ids]),
    ]);
    const laborByOrder = new Map<string, { seconds: number; cost: number }>(
      (laborRows as any[]).map((r) => [r.oid, { seconds: Number(r.seconds), cost: round2(Number(r.cost)) }]),
    );

    const rows = orders.map((o) => {
      const clk = laborByOrder.get(o.id) ?? { seconds: 0, cost: 0 };
      const px = proxyMap.get(o.id) ?? { seconds: 0, cost: 0, machineSeconds: 0, machineCost: 0, overhead: 0, stages: 0 };
      const mc = machineMap.get(o.id) ?? { seconds: 0, cost: 0 };
      const labor = { seconds: clk.seconds + px.seconds, cost: round2(clk.cost + px.cost) };
      const machine = { seconds: mc.seconds + px.machineSeconds, cost: round2(mc.cost + px.machineCost) };
      const material = materialMap.get(o.id) ?? 0;
      const overhead = round2((overheadMap.get(o.id) ?? 0) + px.overhead);
      const totals = composeTotals(material, labor.cost, settings.overheadPercent, machine.cost, overhead);
      return {
        orderId: o.id,
        number: o.number,
        customerName: o.customer_name,
        quantity: Number(o.quantity),
        status: o.status,
        createdAt: o.created_at,
        project: { id: o.project_id, name: o.project_name },
        laborHours: round2(labor.seconds / 3600),
        machineHours: round2(machine.seconds / 3600),
        ...totals,
      };
    });
    return {
      currency: settings.currency,
      settings,
      kpis: {
        orders: rows.length,
        laborCost: round2(rows.reduce((s, r) => s + r.laborCost, 0)),
        machineCost: round2(rows.reduce((s, r) => s + r.machineCost, 0)),
        materialCost: round2(rows.reduce((s, r) => s + r.materialCost, 0)),
        overheadCost: round2(rows.reduce((s, r) => s + r.overheadCost, 0)),
        totalCost: round2(rows.reduce((s, r) => s + r.totalCost, 0)),
      },
      orders: rows,
    };
  }
}
