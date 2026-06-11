import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Not, Repository } from 'typeorm';
import { ProductionOrder, ProductionOrderStatus } from './production-order.entity.js';
import { Project } from './project.entity.js';
import { AssemblyNode, AssemblyNodeType } from './assembly-node.entity.js';
import { WorkOrder, WorkOrderStatus } from '../work-orders/work-order.entity.js';
import { WorkOrderStage, WorkOrderStageStatus } from '../work-orders/work-order-stage.entity.js';
import { Stage } from '../stages/stage.entity.js';
import { Product } from '../products/product.entity.js';
import { Ncr, NcrStatus } from '../quality-ncr/entities/ncr.entity.js';
import { EventsGateway } from '../websocket/events.gateway.js';
import { isQualityStageName, qcGateMessage } from '../work-orders/qc-gate.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { CreateProductionOrderDto, UpdateProductionOrderDto } from './production-order.dto.js';
import { stageStatusFromCount, stageUnitsTotal, clamp, rollupCounts, StageStatus } from './quantity-math.js';

/**
 * Production orders = per-customer/per-run instances of a project. Each order
 * carries its OWN process + quantity, and stage progress is tracked PER ORDER
 * (count-based) on its own per-assembly work orders — so the same design built
 * for two customers tracks independently. Reuses the WorkOrder/WorkOrderStage
 * engine, scoped via WorkOrder.productionOrderId. Tenant-scoped.
 */
@Injectable()
export class ProductionOrderService {
  constructor(
    @InjectRepository(ProductionOrder) private readonly orderRepo: Repository<ProductionOrder>,
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    @InjectRepository(AssemblyNode) private readonly nodeRepo: Repository<AssemblyNode>,
    @InjectRepository(WorkOrder) private readonly woRepo: Repository<WorkOrder>,
    @InjectRepository(WorkOrderStage) private readonly wosRepo: Repository<WorkOrderStage>,
    @InjectRepository(Stage) private readonly stageRepo: Repository<Stage>,
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    @InjectRepository(Ncr) private readonly ncrRepo: Repository<Ncr>,
    private readonly events: EventsGateway,
  ) {}

  private get org(): string { return TenantContext.requireOrganizationId(); }

  private toStageEnum(s: StageStatus): WorkOrderStageStatus {
    return s === 'completed' ? WorkOrderStageStatus.COMPLETED
      : s === 'in_progress' ? WorkOrderStageStatus.IN_PROGRESS
      : s === 'skipped' ? WorkOrderStageStatus.SKIPPED
      : WorkOrderStageStatus.PENDING;
  }

  private orderDto(o: ProductionOrder) {
    return {
      id: o.id, number: o.number, projectId: o.projectId, customerName: o.customerName,
      quantity: o.quantity, processId: o.processId, status: o.status, dueDate: o.dueDate,
      notes: o.notes, createdAt: o.createdAt,
    };
  }

  /**
   * Create an order AND release it: generate per-assembly work orders + stages
   * (count-based totals). Fully TRANSACTIONAL — either the order with ALL its
   * work orders and stages is created, or nothing is (no half-created orders
   * behind a 500). A unique-number race retries the whole transaction.
   */
  async create(projectId: string, dto: CreateProductionOrderDto): Promise<ProductionOrder> {
    const org = this.org;
    for (let attempt = 0; ; attempt++) {
      try {
        const order = await this.orderRepo.manager.transaction((em) => this.createInTx(em, org, projectId, dto));
        this.events.emitDashboardRefresh();
        return order;
      } catch (e: any) {
        if (e?.code === '23505' && attempt < 4) continue; // number race — retry the whole transaction
        throw e;
      }
    }
  }

  private async createInTx(em: EntityManager, org: string, projectId: string, dto: CreateProductionOrderDto): Promise<ProductionOrder> {
    const orderRepo = em.getRepository(ProductionOrder);
    const nodeRepo = em.getRepository(AssemblyNode);
    const woRepo = em.getRepository(WorkOrder);
    const wosRepo = em.getRepository(WorkOrderStage);

    const project = await em.getRepository(Project).findOne({ where: { id: projectId, organizationId: org } });
    if (!project) throw new NotFoundException('Project not found');
    const stages = await em.getRepository(Stage).find({ where: { processId: dto.processId, organizationId: org }, order: { sequence: 'ASC' } });
    if (!stages.length) throw new BadRequestException('Chosen process has no stages (or is not in this organization)');

    const quantity = dto.quantity ?? 1;
    const year = new Date().getFullYear();

    // MAX-based numbering: count() drifts behind the highest number after deletes.
    const ordBase = await this.maxNumberSuffix('production_orders', 'number', `ORD-${year}-`, em);
    const order = await orderRepo.save(orderRepo.create({
      projectId, number: `ORD-${year}-${String(ordBase + 1).padStart(4, '0')}`,
      customerName: dto.customerName ?? null, quantity, processId: dto.processId,
      status: ProductionOrderStatus.PLANNED, dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      notes: dto.notes ?? null, organizationId: org,
    }));

    // Work orders require a product; one stand-in product represents the project.
    const productRepo = em.getRepository(Product);
    let product = await productRepo.findOne({ where: { organizationId: org, name: project.name } });
    if (!product) {
      product = await productRepo.save(productRepo.create({
        name: project.name, description: `Fabrication project ${project.projectNumber ?? ''}`.trim(), organizationId: org,
      }));
    }

    // Trackable production items = assemblies/subassemblies, PLUS "loose" parts
    // with no assembly/subassembly ancestor (so parts-only projects still track).
    const allNodes = await nodeRepo.find({ where: { organizationId: org, projectId }, order: { depth: 'ASC', sortIndex: 'ASC' } });
    const byId = new Map(allNodes.map((n) => [n.id, n]));
    const isAsm = (t: unknown): boolean => { const s = String(t); return s === 'assembly' || s === 'subassembly'; };
    const hasAsmAncestor = (n: AssemblyNode): boolean => {
      let pid = n.parentId;
      const seen = new Set<string>();
      while (pid && !seen.has(pid)) { seen.add(pid); const a = byId.get(pid); if (!a) break; if (isAsm(a.nodeType)) return true; pid = a.parentId; }
      return false;
    };
    const nodes = allNodes.filter((n) => isAsm(n.nodeType) || (String(n.nodeType) === 'part' && !hasAsmAncestor(n)));

    // A project with no imported structure is still orderable: auto-create one
    // root assembly representing the deliverable so qty-N tracking works.
    if (!nodes.length) {
      const root = await nodeRepo.save(nodeRepo.create({
        projectId,
        organizationId: org,
        parentId: null,
        nodeType: AssemblyNodeType.ASSEMBLY,
        name: project.name,
        mark: project.projectNumber || project.name,
        quantity: 1,
        depth: 0,
        sortIndex: 0,
      }));
      nodes.push(root);
    }

    // Batch the inserts (one save for all work orders, one for all stages) — a
    // per-row sequential loop is far too slow against a remote DB at real scale.
    const woBase = await this.maxNumberSuffix('work_orders', 'order_number', `WO-${year}-`, em);
    const woEntities = nodes.map((node, i) => woRepo.create({
      orderNumber: `WO-${year}-${String(woBase + 1 + i).padStart(4, '0')}`,
      productId: product.id, processId: dto.processId, assemblyNodeId: node.id, productionOrderId: order.id,
      quantity: node.quantity ?? 1, status: WorkOrderStatus.PENDING, organizationId: org,
    }));
    const savedWos = await woRepo.save(woEntities, { chunk: 200 });

    const stageEntities: WorkOrderStage[] = [];
    savedWos.forEach((wo, i) => {
      const total = stageUnitsTotal(nodes[i].quantity ?? 1, quantity);
      for (const st of stages) {
        stageEntities.push(wosRepo.create({
          workOrderId: wo.id, stageId: st.id, status: WorkOrderStageStatus.PENDING,
          qtyTotal: total, qtyDone: 0, organizationId: org,
        }));
      }
    });
    await wosRepo.save(stageEntities, { chunk: 500 });
    return order;
  }

  /** Highest numeric suffix among numbers with the given prefix (e.g. 'WO-2026-'). 0 when none. */
  private async maxNumberSuffix(table: string, column: string, prefix: string, em?: EntityManager): Promise<number> {
    const runner = em ?? this.woRepo.manager;
    const rows: { num: string }[] = await runner.query(
      `SELECT ${column} AS num FROM ${table} WHERE ${column} LIKE $1 ORDER BY ${column} DESC LIMIT 1`,
      [`${prefix}%`],
    );
    const raw = rows?.[0]?.num;
    if (!raw) return 0;
    const n = parseInt(raw.slice(prefix.length), 10);
    return Number.isFinite(n) ? n : 0;
  }

  private async saveWoWithNumber(org: string, productId: string, processId: string, node: AssemblyNode, productionOrderId: string): Promise<WorkOrder> {
    const year = new Date().getFullYear();
    for (let attempt = 0; attempt < 5; attempt++) {
      const base = await this.maxNumberSuffix('work_orders', 'order_number', `WO-${year}-`);
      const orderNumber = `WO-${year}-${String(base + 1).padStart(4, '0')}`;
      try {
        return await this.woRepo.save(this.woRepo.create({
          orderNumber, productId, processId, assemblyNodeId: node.id, productionOrderId,
          quantity: node.quantity ?? 1, status: WorkOrderStatus.PENDING, organizationId: org,
        }));
      } catch (e: any) {
        if (e?.code === '23505') continue;
        throw e;
      }
    }
    throw new BadRequestException('Could not allocate a unique work-order number');
  }

  listByProject(projectId: string): Promise<ProductionOrder[]> {
    return this.orderRepo.find({ where: { projectId, organizationId: this.org }, order: { createdAt: 'DESC' } });
  }

  /**
   * Org-wide work-orders DASHBOARD: every production order (all projects) with
   * its progress roll-up, plus KPIs and a cross-order stage funnel. Built from
   * four aggregate queries — never N+1 per order.
   */
  async dashboard() {
    const org = this.org;

    const orders: any[] = await this.orderRepo.query(
      `SELECT o.id, o.number, o.customer_name, o.quantity, o.status, o.due_date, o.created_at,
              p.id AS project_id, p.name AS project_name, p.project_number
         FROM production_orders o
         JOIN projects p ON p.id = o.project_id
        WHERE o.organization_id = $1
        ORDER BY o.created_at DESC`,
      [org],
    );

    // Per-order progress: items (per-assembly WOs) + count-based units.
    const agg: any[] = await this.orderRepo.query(
      `SELECT w.production_order_id AS oid,
              COUNT(DISTINCT w.id)::int AS items,
              COUNT(DISTINCT w.id) FILTER (WHERE w.status = 'completed')::int AS items_done,
              COALESCE(SUM(s.qty_total) FILTER (WHERE s.status <> 'skipped'), 0)::int AS units_total,
              COALESCE(SUM(LEAST(s.qty_done, s.qty_total)) FILTER (WHERE s.status <> 'skipped'), 0)::int AS units_done
         FROM work_orders w
         LEFT JOIN work_order_stages s ON s.work_order_id = w.id
        WHERE w.organization_id = $1 AND w.production_order_id IS NOT NULL
        GROUP BY w.production_order_id`,
      [org],
    );
    const aggByOrder = new Map<string, any>(agg.map((a) => [a.oid, a]));

    // Quality holds: open NCRs linked (via their work order) to each order.
    const ncrAgg: any[] = await this.orderRepo.query(
      `SELECT w.production_order_id AS oid, COUNT(n.id)::int AS open_ncrs
         FROM ncrs n
         JOIN work_orders w ON w.id = n.work_order_id
        WHERE n.organization_id = $1 AND n.status NOT IN ('closed','cancelled')
          AND w.production_order_id IS NOT NULL
        GROUP BY w.production_order_id`,
      [org],
    );
    const ncrByOrder = new Map<string, number>(ncrAgg.map((a) => [a.oid, Number(a.open_ncrs)]));

    // Cross-order stage funnel (active orders only) — the bottleneck view.
    const funnelRows: any[] = await this.orderRepo.query(
      `SELECT st.name, st.sequence,
              COALESCE(SUM(s.qty_total) FILTER (WHERE s.status <> 'skipped'), 0)::int AS total,
              COALESCE(SUM(LEAST(s.qty_done, s.qty_total)) FILTER (WHERE s.status <> 'skipped'), 0)::int AS done
         FROM work_order_stages s
         JOIN work_orders w ON w.id = s.work_order_id
         JOIN production_orders o ON o.id = w.production_order_id
         JOIN stages st ON st.id = s.stage_id
        WHERE s.organization_id = $1 AND o.status IN ('planned','in_progress')
        GROUP BY st.name, st.sequence
        ORDER BY st.sequence, st.name`,
      [org],
    );
    const funnel = funnelRows.map((f) => ({
      name: f.name,
      sequence: Number(f.sequence),
      done: Number(f.done),
      total: Number(f.total),
      percent: Number(f.total) > 0 ? Math.round((Number(f.done) / Number(f.total)) * 1000) / 10 : 0,
    }));

    const now = Date.now();
    const rows = orders.map((o) => {
      const a = aggByOrder.get(o.id) ?? { items: 0, items_done: 0, units_total: 0, units_done: 0 };
      const unitsTotal = Number(a.units_total);
      const unitsDone = Number(a.units_done);
      const active = o.status === 'planned' || o.status === 'in_progress';
      return {
        id: o.id,
        number: o.number,
        customerName: o.customer_name,
        quantity: Number(o.quantity),
        status: o.status,
        dueDate: o.due_date,
        createdAt: o.created_at,
        project: { id: o.project_id, name: o.project_name, number: o.project_number },
        items: Number(a.items),
        itemsDone: Number(a.items_done),
        unitsDone,
        unitsTotal,
        percent: unitsTotal > 0 ? Math.round((unitsDone / unitsTotal) * 1000) / 10 : 0,
        openNcrs: ncrByOrder.get(o.id) ?? 0,
        late: !!o.due_date && active && new Date(o.due_date).getTime() < now,
      };
    });

    const activeRows = rows.filter((r) => r.status === 'planned' || r.status === 'in_progress');
    const kpis = {
      orders: rows.length,
      planned: rows.filter((r) => r.status === 'planned').length,
      inProgress: rows.filter((r) => r.status === 'in_progress').length,
      completed: rows.filter((r) => r.status === 'completed').length,
      cancelled: rows.filter((r) => r.status === 'cancelled').length,
      late: rows.filter((r) => r.late).length,
      openNcrs: [...ncrByOrder.values()].reduce((a, b) => a + b, 0),
      unitsDone: activeRows.reduce((a, r) => a + r.unitsDone, 0),
      unitsTotal: activeRows.reduce((a, r) => a + r.unitsTotal, 0),
      itemsInProduction: activeRows.reduce((a, r) => a + r.items, 0),
    };

    return { kpis, funnel, orders: rows };
  }

  async get(orderId: string): Promise<ProductionOrder> {
    const o = await this.orderRepo.findOne({ where: { id: orderId, organizationId: this.org } });
    if (!o) throw new NotFoundException('Work order not found');
    return o;
  }

  async update(orderId: string, dto: UpdateProductionOrderDto): Promise<ProductionOrder> {
    const o = await this.get(orderId);
    if (dto.customerName !== undefined) o.customerName = dto.customerName;
    if (dto.status !== undefined) o.status = dto.status as ProductionOrderStatus;
    if (dto.dueDate !== undefined) o.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    if (dto.notes !== undefined) o.notes = dto.notes;
    return this.orderRepo.save(o);
  }

  async remove(orderId: string): Promise<{ ok: true }> {
    const org = this.org;
    await this.get(orderId);
    await this.woRepo.delete({ productionOrderId: orderId, organizationId: org }); // stages cascade via WO FK
    await this.orderRepo.delete({ id: orderId, organizationId: org });
    return { ok: true };
  }

  /**
   * Update one stage's progress (no forced order). Two modes:
   *  - `qtyDone` (the quantity stepper): set the count, derive the status.
   *  - `status` (qty=1 three-state, or skip): set the status, sync the count.
   */
  async setStageProgress(orderId: string, workOrderStageId: string, input: { qtyDone?: number; status?: string }): Promise<WorkOrderStage> {
    const org = this.org;
    await this.get(orderId);
    const wos = await this.wosRepo.findOne({ where: { id: workOrderStageId, organizationId: org }, relations: ['stage'] });
    if (!wos) throw new NotFoundException('Work-order stage not found');
    const wo = await this.woRepo.findOne({ where: { id: wos.workOrderId, organizationId: org } });
    if (!wo || wo.productionOrderId !== orderId) throw new BadRequestException('That stage does not belong to this work order');
    const total = wos.qtyTotal ?? 0;
    const prevStatus = wos.status;

    if (input.status !== undefined) {
      const s = input.status;
      if (s === 'completed') { wos.qtyDone = total; wos.status = WorkOrderStageStatus.COMPLETED; }
      else if (s === 'skipped') { wos.status = WorkOrderStageStatus.SKIPPED; }
      else if (s === 'in_progress') { wos.status = WorkOrderStageStatus.IN_PROGRESS; if (total > 0 && wos.qtyDone >= total) wos.qtyDone = Math.max(0, total - 1); }
      else { wos.qtyDone = 0; wos.status = WorkOrderStageStatus.PENDING; }
    } else {
      const done = clamp(input.qtyDone ?? 0, 0, total);
      wos.qtyDone = done;
      wos.status = this.toStageEnum(stageStatusFromCount(done, total, wos.status === WorkOrderStageStatus.SKIPPED));
    }

    // Quality gate: a quality stage can't reach COMPLETED while its assembly has open NCRs.
    if (
      wos.status === WorkOrderStageStatus.COMPLETED &&
      prevStatus !== WorkOrderStageStatus.COMPLETED &&
      wo.assemblyNodeId &&
      isQualityStageName(wos.stage?.name)
    ) {
      const open = await this.ncrRepo.count({
        where: { assemblyNodeId: wo.assemblyNodeId, organizationId: org, status: Not(In([NcrStatus.CLOSED, NcrStatus.CANCELLED])) },
      });
      if (open > 0) {
        // Speak in shop terms: the part mark, not the internal WO number.
        const node = await this.nodeRepo.findOne({ where: { id: wo.assemblyNodeId, organizationId: org } });
        throw new BadRequestException(qcGateMessage(node?.mark || node?.name || wo.orderNumber, open));
      }
    }

    if (wos.status === WorkOrderStageStatus.IN_PROGRESS && !wos.startedAt) wos.startedAt = new Date();
    wos.completedAt = wos.status === WorkOrderStageStatus.COMPLETED ? (wos.completedAt ?? new Date()) : null;
    const saved = await this.wosRepo.save(wos);

    // Live propagation: WO status ← its stages; order status ← its WOs.
    await this.syncWorkOrderStatus(wo);
    await this.syncOrderStatus(orderId);
    this.events.emitWorkOrderUpdate({ id: wo.id, productionOrderId: orderId, workOrderStageId: saved.id, status: String(saved.status) });
    this.events.emitDashboardRefresh();
    return saved;
  }

  /** Derive a per-assembly WO's status from its stage rows (sets started/completed stamps). */
  private async syncWorkOrderStatus(wo: WorkOrder): Promise<void> {
    const rows = await this.wosRepo.find({ where: { workOrderId: wo.id } });
    if (!rows.length) return;
    const done = rows.every((r) => r.status === WorkOrderStageStatus.COMPLETED || r.status === WorkOrderStageStatus.SKIPPED);
    const any = rows.some(
      (r) => r.status === WorkOrderStageStatus.IN_PROGRESS || r.status === WorkOrderStageStatus.COMPLETED || (r.qtyDone ?? 0) > 0,
    );
    const next = done ? WorkOrderStatus.COMPLETED : any ? WorkOrderStatus.IN_PROGRESS : WorkOrderStatus.PENDING;
    if (wo.status === next) return;
    wo.status = next;
    const now = new Date();
    if (next === WorkOrderStatus.IN_PROGRESS && !wo.startedAt) wo.startedAt = now;
    if (next === WorkOrderStatus.COMPLETED) {
      wo.completedAt = wo.completedAt ?? now;
      wo.completedQuantity = wo.quantity;
    } else {
      wo.completedAt = null;
    }
    await this.woRepo.save(wo);
  }

  /** Derive the order's status from its per-assembly WOs (cancelled stays manual). */
  private async syncOrderStatus(orderId: string): Promise<void> {
    const order = await this.orderRepo.findOne({ where: { id: orderId, organizationId: this.org } });
    if (!order || order.status === ProductionOrderStatus.CANCELLED) return;
    const wos = await this.woRepo.find({ where: { productionOrderId: orderId, organizationId: this.org } });
    if (!wos.length) return;
    const done = wos.every((w) => w.status === WorkOrderStatus.COMPLETED);
    const any = wos.some((w) => w.status === WorkOrderStatus.IN_PROGRESS || w.status === WorkOrderStatus.COMPLETED);
    const next = done ? ProductionOrderStatus.COMPLETED : any ? ProductionOrderStatus.IN_PROGRESS : ProductionOrderStatus.PLANNED;
    if (order.status !== next) {
      order.status = next;
      await this.orderRepo.save(order);
    }
  }

  /** One assembly's stages within an order (with counts), for the item detail screen. */
  async getNodeStages(orderId: string, nodeId: string) {
    const org = this.org;
    await this.get(orderId);
    const wo = await this.woRepo.findOne({ where: { productionOrderId: orderId, assemblyNodeId: nodeId, organizationId: org } });
    if (!wo) return { orderId, workOrderId: null, nodeStatus: 'not_started', percentComplete: 0, stages: [] as any[] };
    const rows = await this.wosRepo.find({ where: { workOrderId: wo.id }, relations: ['stage'] });
    const stages = rows
      .map((r) => ({ id: r.id, stageId: r.stageId, name: r.stage?.name ?? 'Stage', sequence: r.stage?.sequence ?? 0, status: String(r.status), qtyDone: r.qtyDone ?? 0, qtyTotal: r.qtyTotal ?? 0 }))
      .sort((a, b) => a.sequence - b.sequence);
    const rollup = rollupCounts(rows.map((r) => ({ qtyDone: r.qtyDone ?? 0, qtyTotal: r.qtyTotal ?? 0, skipped: r.status === WorkOrderStageStatus.SKIPPED })));
    return { orderId, workOrderId: wo.id, nodeStatus: rollup.status, percentComplete: rollup.percentComplete, stages };
  }

  /** Kanban/board for one order: stages + each assembly's per-stage counts. */
  async getStageBoard(orderId: string) {
    const org = this.org;
    const order = await this.get(orderId);
    const stages = order.processId
      ? await this.stageRepo.find({ where: { processId: order.processId, organizationId: org }, order: { sequence: 'ASC' } })
      : [];
    const wos = await this.woRepo.find({ where: { productionOrderId: orderId, organizationId: org } });
    const stageList = stages.map((s) => ({ id: s.id, name: s.name, sequence: s.sequence }));
    if (!wos.length) return { order: this.orderDto(order), stages: stageList, items: [] };

    const nodeIds = wos.map((w) => w.assemblyNodeId).filter((x): x is string => !!x);
    const nodes = await this.nodeRepo.find({ where: { id: In(nodeIds), organizationId: org } });
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const woById = new Map(wos.map((w) => [w.id, w]));
    const rows = await this.wosRepo.find({ where: { workOrderId: In(wos.map((w) => w.id)) }, relations: ['stage'] });

    const byNode = new Map<string, any>();
    for (const r of rows) {
      const wo = woById.get(r.workOrderId);
      const node = wo?.assemblyNodeId ? nodeById.get(wo.assemblyNodeId) : undefined;
      if (!node) continue;
      let it = byNode.get(node.id);
      if (!it) {
        it = { nodeId: node.id, mark: node.mark || node.name, nodeType: String(node.nodeType), stages: [] };
        byNode.set(node.id, it);
      }
      it.stages.push({
        stageId: r.stageId, workOrderStageId: r.id, status: String(r.status),
        qtyDone: r.qtyDone ?? 0, qtyTotal: r.qtyTotal ?? 0, sequence: r.stage?.sequence ?? 0,
      });
    }
    const items = [...byNode.values()];
    for (const it of items) it.stages.sort((a: any, b: any) => a.sequence - b.sequence);
    return { order: this.orderDto(order), stages: stageList, items };
  }

  /** Count-based roll-up for one order: overall % + per-stage funnel. */
  async getProgress(orderId: string) {
    const org = this.org;
    await this.get(orderId);
    const wos = await this.woRepo.find({ where: { productionOrderId: orderId, organizationId: org } });
    const rows = wos.length ? await this.wosRepo.find({ where: { workOrderId: In(wos.map((w) => w.id)) }, relations: ['stage'] }) : [];
    const rollup = rollupCounts(rows.map((r) => ({ qtyDone: r.qtyDone ?? 0, qtyTotal: r.qtyTotal ?? 0, skipped: r.status === WorkOrderStageStatus.SKIPPED })));

    const funnel = new Map<string, { stageId: string; name: string; sequence: number; done: number; total: number }>();
    for (const r of rows) {
      const f = funnel.get(r.stageId) ?? { stageId: r.stageId, name: r.stage?.name ?? 'Stage', sequence: r.stage?.sequence ?? 0, done: 0, total: 0 };
      if (r.status !== WorkOrderStageStatus.SKIPPED) {
        const t = r.qtyTotal ?? 0;
        f.total += t;
        f.done += Math.min(r.qtyDone ?? 0, t);
      }
      funnel.set(r.stageId, f);
    }
    const stages = [...funnel.values()]
      .sort((a, b) => a.sequence - b.sequence)
      .map((f) => ({ ...f, percent: f.total ? Math.round((f.done / f.total) * 10000) / 100 : 0 }));

    return {
      orderId,
      status: rollup.status,
      percentComplete: rollup.percentComplete,
      unitsDone: rollup.unitsDone,
      unitsTotal: rollup.unitsTotal,
      assemblies: wos.length,
      stages,
    };
  }
}
