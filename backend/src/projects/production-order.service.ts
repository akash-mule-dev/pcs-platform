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
import { CreateProductionOrderDto, UpdateProductionOrderDto, BulkStageUpdateDto } from './production-order.dto.js';
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
    const prevStatus = wos.status;

    this.applyStageInput(wos, input);

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

    const saved = await this.wosRepo.save(wos);

    // Live propagation: WO status ← its stages; order status ← its WOs.
    await this.syncWorkOrderStatus(wo);
    await this.syncOrderStatus(orderId);
    this.events.emitWorkOrderUpdate({ id: wo.id, productionOrderId: orderId, workOrderStageId: saved.id, status: String(saved.status) });
    this.events.emitDashboardRefresh();
    return saved;
  }

  /**
   * Apply a qtyDone/status input to a stage row (pure mutation, no save):
   * derives the counterpart field and keeps the started/completed stamps honest.
   * Shared by the single-stage PATCH and the bulk update so both behave identically.
   */
  private applyStageInput(wos: WorkOrderStage, input: { qtyDone?: number; status?: string }): void {
    const total = wos.qtyTotal ?? 0;
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
    if (wos.status === WorkOrderStageStatus.IN_PROGRESS && !wos.startedAt) wos.startedAt = new Date();
    wos.completedAt = wos.status === WorkOrderStageStatus.COMPLETED ? (wos.completedAt ?? new Date()) : null;
  }

  /** Open-NCR counts per assembly node, in ONE query (the bulk QC gate). */
  private async openNcrCountByNode(nodeIds: string[]): Promise<Map<string, number>> {
    if (!nodeIds.length) return new Map();
    const rows: { nid: string; cnt: string }[] = await this.ncrRepo.query(
      `SELECT assembly_node_id AS nid, COUNT(*)::int AS cnt
         FROM ncrs
        WHERE organization_id = $1 AND assembly_node_id = ANY($2)
          AND status NOT IN ('closed','cancelled')
        GROUP BY assembly_node_id`,
      [this.org, nodeIds],
    );
    return new Map(rows.map((r) => [r.nid, Number(r.cnt)]));
  }

  /** Derive a per-assembly WO's status from its stage rows (sets started/completed stamps). */
  private async syncWorkOrderStatus(wo: WorkOrder): Promise<void> {
    await this.syncWorkOrderStatuses([wo]);
  }

  /** Batched WO-status sync: one stage query + one save for ALL given WOs (bulk-safe). */
  private async syncWorkOrderStatuses(wos: WorkOrder[]): Promise<void> {
    if (!wos.length) return;
    const rows = await this.wosRepo.find({ where: { workOrderId: In(wos.map((w) => w.id)) } });
    const byWo = new Map<string, WorkOrderStage[]>();
    for (const r of rows) {
      const arr = byWo.get(r.workOrderId) ?? [];
      arr.push(r);
      byWo.set(r.workOrderId, arr);
    }
    const now = new Date();
    const changed: WorkOrder[] = [];
    for (const wo of wos) {
      const stageRows = byWo.get(wo.id) ?? [];
      if (!stageRows.length) continue;
      const done = stageRows.every((r) => r.status === WorkOrderStageStatus.COMPLETED || r.status === WorkOrderStageStatus.SKIPPED);
      const any = stageRows.some(
        (r) => r.status === WorkOrderStageStatus.IN_PROGRESS || r.status === WorkOrderStageStatus.COMPLETED || (r.qtyDone ?? 0) > 0,
      );
      const next = done ? WorkOrderStatus.COMPLETED : any ? WorkOrderStatus.IN_PROGRESS : WorkOrderStatus.PENDING;
      if (wo.status === next) continue;
      wo.status = next;
      if (next === WorkOrderStatus.IN_PROGRESS && !wo.startedAt) wo.startedAt = now;
      if (next === WorkOrderStatus.COMPLETED) {
        wo.completedAt = wo.completedAt ?? now;
        wo.completedQuantity = wo.quantity;
      } else {
        wo.completedAt = null;
      }
      changed.push(wo);
    }
    if (changed.length) await this.woRepo.save(changed, { chunk: 200 });
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

  /**
   * Batch update: apply ONE stage change to MANY assemblies of this order in a
   * single request (the dashboard's "bulk edit"). Reuses the exact single-row
   * semantics via applyStageInput, enforces the QC gate per assembly (gated rows
   * are reported, not saved), then syncs WO + order status once at the end.
   */
  async bulkStageUpdate(orderId: string, dto: BulkStageUpdateDto) {
    const org = this.org;
    if (dto.qtyDone === undefined && dto.status === undefined) {
      throw new BadRequestException('Provide qtyDone or status to apply');
    }
    await this.get(orderId);

    const nodeIds = [...new Set(dto.nodeIds)];
    const wos = await this.woRepo.find({ where: { productionOrderId: orderId, organizationId: org, assemblyNodeId: In(nodeIds) } });
    const woByNode = new Map(wos.filter((w) => w.assemblyNodeId).map((w) => [w.assemblyNodeId as string, w]));
    const nodes = nodeIds.length ? await this.nodeRepo.find({ where: { id: In(nodeIds), organizationId: org } }) : [];
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const rows = wos.length
      ? await this.wosRepo.find({ where: { workOrderId: In(wos.map((w) => w.id)), stageId: dto.stageId }, relations: ['stage'] })
      : [];
    const rowByWo = new Map(rows.map((r) => [r.workOrderId, r]));

    // The QC gate needs open-NCR counts only when this is a quality stage.
    const gateNeeded = rows.some((r) => isQualityStageName(r.stage?.name));
    const ncrByNode = gateNeeded ? await this.openNcrCountByNode(nodeIds) : new Map<string, number>();

    const failed: { nodeId: string; mark: string; message: string }[] = [];
    const toSave: WorkOrderStage[] = [];
    const touched: WorkOrder[] = [];
    for (const nodeId of nodeIds) {
      const mark = nodeById.get(nodeId)?.mark || nodeById.get(nodeId)?.name || nodeId;
      const wo = woByNode.get(nodeId);
      const row = wo ? rowByWo.get(wo.id) : undefined;
      if (!wo || !row) {
        failed.push({ nodeId, mark, message: 'No matching stage on this assembly in this work order' });
        continue;
      }
      const prevStatus = row.status;
      this.applyStageInput(row, { qtyDone: dto.qtyDone, status: dto.status });
      if (
        row.status === WorkOrderStageStatus.COMPLETED &&
        prevStatus !== WorkOrderStageStatus.COMPLETED &&
        isQualityStageName(row.stage?.name)
      ) {
        const open = ncrByNode.get(nodeId) ?? 0;
        if (open > 0) {
          failed.push({ nodeId, mark, message: qcGateMessage(mark, open) }); // not saved → DB row untouched
          continue;
        }
      }
      toSave.push(row);
      touched.push(wo);
    }

    if (toSave.length) {
      await this.wosRepo.save(toSave, { chunk: 200 });
      await this.syncWorkOrderStatuses(touched);
      await this.syncOrderStatus(orderId);
      this.events.emitWorkOrderUpdate({ productionOrderId: orderId, bulk: true, updated: toSave.length });
      this.events.emitDashboardRefresh();
    }
    return { requested: nodeIds.length, updated: toSave.length, failed };
  }

  /**
   * AUDIT view for one order — everything the per-order dashboard needs in one
   * call: the order + project, its stage columns, per-assembly rows with every
   * stage's status/counts/stamps/people, logged time and quality holds.
   * Built from 5 batch queries — never N+1 per assembly.
   */
  async getAudit(orderId: string) {
    const org = this.org;
    const order = await this.get(orderId);
    const project = await this.projectRepo.findOne({ where: { id: order.projectId, organizationId: org } });

    const stages = order.processId
      ? await this.stageRepo.find({ where: { processId: order.processId, organizationId: org }, order: { sequence: 'ASC' } })
      : [];
    const wos = await this.woRepo.find({ where: { productionOrderId: orderId, organizationId: org } });
    const nodeIds = wos.map((w) => w.assemblyNodeId).filter((x): x is string => !!x);
    const nodes = nodeIds.length ? await this.nodeRepo.find({ where: { id: In(nodeIds), organizationId: org } }) : [];
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const rows = wos.length
      ? await this.wosRepo.find({ where: { workOrderId: In(wos.map((w) => w.id)) }, relations: ['stage', 'assignedUser', 'station'] })
      : [];

    // Logged time per stage row (closed time entries) — one aggregate query.
    const timeAgg: { wos_id: string; seconds: string; entries: string }[] = wos.length
      ? await this.orderRepo.query(
          `SELECT te.work_order_stage_id AS wos_id,
                  COALESCE(SUM(te.duration_seconds), 0)::int AS seconds,
                  COUNT(*)::int AS entries
             FROM time_entries te
             JOIN work_order_stages s ON s.id = te.work_order_stage_id
             JOIN work_orders w ON w.id = s.work_order_id
            WHERE te.organization_id = $1 AND w.production_order_id = $2
            GROUP BY te.work_order_stage_id`,
          [org, orderId],
        )
      : [];
    const timeByWos = new Map(timeAgg.map((t) => [t.wos_id, { seconds: Number(t.seconds), entries: Number(t.entries) }]));
    const ncrByNode = await this.openNcrCountByNode(nodeIds);

    const rowsByWo = new Map<string, WorkOrderStage[]>();
    for (const r of rows) {
      const arr = rowsByWo.get(r.workOrderId) ?? [];
      arr.push(r);
      rowsByWo.set(r.workOrderId, arr);
    }

    // Stage columns from the process; fall back to whatever the rows reference
    // (orders survive a deleted/edited process).
    let stageList = stages.map((s) => ({ id: s.id, name: s.name, sequence: s.sequence }));
    if (!stageList.length) {
      const seen = new Map<string, { id: string; name: string; sequence: number }>();
      for (const r of rows) if (r.stage && !seen.has(r.stageId)) seen.set(r.stageId, { id: r.stageId, name: r.stage.name, sequence: r.stage.sequence });
      stageList = [...seen.values()].sort((a, b) => a.sequence - b.sequence);
    }

    const items = wos.map((wo) => {
      const node = wo.assemblyNodeId ? nodeById.get(wo.assemblyNodeId) : undefined;
      const woRows = (rowsByWo.get(wo.id) ?? []).sort((a, b) => (a.stage?.sequence ?? 0) - (b.stage?.sequence ?? 0));
      const rollup = rollupCounts(woRows.map((r) => ({ qtyDone: r.qtyDone ?? 0, qtyTotal: r.qtyTotal ?? 0, skipped: r.status === WorkOrderStageStatus.SKIPPED })));
      let itemSeconds = 0;
      let lastActivity: Date | null = null;
      const stageRows = woRows.map((r) => {
        const t = timeByWos.get(r.id);
        const seconds = t?.seconds ?? r.actualTimeSeconds ?? 0;
        itemSeconds += seconds;
        // "Status updated" only once the stage has actually moved — fresh rows stay blank.
        const moved = r.status !== WorkOrderStageStatus.PENDING || (r.qtyDone ?? 0) > 0;
        const statusUpdatedAt = moved ? (r.updatedAt ?? r.completedAt ?? r.startedAt ?? null) : null;
        if (statusUpdatedAt && (!lastActivity || statusUpdatedAt > lastActivity)) lastActivity = statusUpdatedAt;
        return {
          wosId: r.id,
          stageId: r.stageId,
          name: r.stage?.name ?? 'Stage',
          sequence: r.stage?.sequence ?? 0,
          status: String(r.status),
          qtyDone: r.qtyDone ?? 0,
          qtyTotal: r.qtyTotal ?? 0,
          startedAt: r.startedAt,
          completedAt: r.completedAt,
          statusUpdatedAt,
          assignedUser: r.assignedUser ? { id: r.assignedUser.id, name: `${r.assignedUser.firstName ?? ''} ${r.assignedUser.lastName ?? ''}`.trim() } : null,
          station: r.station ? { id: r.station.id, name: r.station.name } : null,
          timeSeconds: seconds,
          timeEntries: t?.entries ?? 0,
        };
      });
      return {
        nodeId: wo.assemblyNodeId,
        workOrderId: wo.id,
        workOrderNumber: wo.orderNumber,
        mark: node?.mark || node?.name || wo.orderNumber,
        name: node?.name ?? null,
        nodeType: node ? String(node.nodeType) : 'assembly',
        profile: node?.profile ?? null,
        materialGrade: node?.materialGrade ?? null,
        lengthMm: node?.lengthMm ?? null,
        weightKg: node?.weightKg ?? null,
        quantity: wo.quantity,
        status: rollup.status,
        percent: rollup.percentComplete,
        unitsDone: rollup.unitsDone,
        unitsTotal: rollup.unitsTotal,
        openNcrs: wo.assemblyNodeId ? (ncrByNode.get(wo.assemblyNodeId) ?? 0) : 0,
        totalTimeSeconds: itemSeconds,
        lastActivityAt: lastActivity,
        stages: stageRows,
      };
    });
    items.sort((a, b) => a.mark.localeCompare(b.mark, undefined, { numeric: true }));

    const totals = {
      items: items.length,
      itemsDone: items.filter((i) => i.status === 'completed').length,
      unitsDone: items.reduce((a, i) => a + i.unitsDone, 0),
      unitsTotal: items.reduce((a, i) => a + i.unitsTotal, 0),
      percent: 0,
      totalTimeSeconds: items.reduce((a, i) => a + i.totalTimeSeconds, 0),
      openNcrs: [...ncrByNode.values()].reduce((a, b) => a + b, 0),
    };
    totals.percent = totals.unitsTotal > 0 ? Math.round((totals.unitsDone / totals.unitsTotal) * 1000) / 10 : 0;

    return {
      order: this.orderDto(order),
      project: project ? { id: project.id, name: project.name, number: project.projectNumber } : null,
      stages: stageList,
      totals,
      items,
    };
  }

  /**
   * Per-assembly audit detail (lazy, for the right pane): the full time-entry
   * trail and the assembly's NCRs — who worked it, where, for how long, and
   * what quality actions are open against it.
   */
  async getNodeAudit(orderId: string, nodeId: string) {
    const org = this.org;
    await this.get(orderId);
    const wo = await this.woRepo.findOne({ where: { productionOrderId: orderId, assemblyNodeId: nodeId, organizationId: org } });
    if (!wo) throw new NotFoundException('This assembly is not part of this work order');

    // Per-stage rows (stamps, people, counts) so mobile renders the whole
    // assembly audit from this one call.
    const wosRows = await this.wosRepo.find({ where: { workOrderId: wo.id }, relations: ['stage', 'assignedUser', 'station'] });
    const stageTimeAgg: { wos_id: string; seconds: string; entries: string }[] = await this.orderRepo.query(
      `SELECT te.work_order_stage_id AS wos_id,
              COALESCE(SUM(te.duration_seconds), 0)::int AS seconds, COUNT(*)::int AS entries
         FROM time_entries te
         JOIN work_order_stages s ON s.id = te.work_order_stage_id
        WHERE te.organization_id = $1 AND s.work_order_id = $2
        GROUP BY te.work_order_stage_id`,
      [org, wo.id],
    );
    const stageTime = new Map(stageTimeAgg.map((t) => [t.wos_id, { seconds: Number(t.seconds), entries: Number(t.entries) }]));
    const rollup = rollupCounts(wosRows.map((r) => ({ qtyDone: r.qtyDone ?? 0, qtyTotal: r.qtyTotal ?? 0, skipped: r.status === WorkOrderStageStatus.SKIPPED })));
    const stages = wosRows
      .sort((a, b) => (a.stage?.sequence ?? 0) - (b.stage?.sequence ?? 0))
      .map((r) => {
        const t = stageTime.get(r.id);
        const moved = r.status !== WorkOrderStageStatus.PENDING || (r.qtyDone ?? 0) > 0;
        return {
          wosId: r.id,
          stageId: r.stageId,
          name: r.stage?.name ?? 'Stage',
          sequence: r.stage?.sequence ?? 0,
          status: String(r.status),
          qtyDone: r.qtyDone ?? 0,
          qtyTotal: r.qtyTotal ?? 0,
          startedAt: r.startedAt,
          completedAt: r.completedAt,
          statusUpdatedAt: moved ? (r.updatedAt ?? r.completedAt ?? r.startedAt ?? null) : null,
          assignedUser: r.assignedUser ? { id: r.assignedUser.id, name: `${r.assignedUser.firstName ?? ''} ${r.assignedUser.lastName ?? ''}`.trim() } : null,
          station: r.station ? { id: r.station.id, name: r.station.name } : null,
          timeSeconds: t?.seconds ?? r.actualTimeSeconds ?? 0,
          timeEntries: t?.entries ?? 0,
        };
      });

    const entries: any[] = await this.orderRepo.query(
      `SELECT te.id, te.start_time, te.end_time, te.duration_seconds, te.is_rework, te.notes, te.input_method,
              u.first_name, u.last_name, st.name AS stage_name, sta.name AS station_name
         FROM time_entries te
         JOIN work_order_stages s ON s.id = te.work_order_stage_id
         LEFT JOIN stages st ON st.id = s.stage_id
         LEFT JOIN users u ON u.id = te.user_id
         LEFT JOIN stations sta ON sta.id = te.station_id
        WHERE te.organization_id = $1 AND s.work_order_id = $2
        ORDER BY te.start_time DESC
        LIMIT 50`,
      [org, wo.id],
    );
    const ncrs = await this.ncrRepo.find({ where: { assemblyNodeId: nodeId, organizationId: org }, order: { createdAt: 'DESC' }, take: 20 });

    return {
      nodeId,
      workOrderId: wo.id,
      workOrderNumber: wo.orderNumber,
      status: rollup.status,
      percentComplete: rollup.percentComplete,
      unitsDone: rollup.unitsDone,
      unitsTotal: rollup.unitsTotal,
      stages,
      timeEntries: entries.map((e) => ({
        id: e.id,
        user: [e.first_name, e.last_name].filter(Boolean).join(' ') || null,
        stageName: e.stage_name ?? null,
        stationName: e.station_name ?? null,
        startTime: e.start_time,
        endTime: e.end_time,
        durationSeconds: e.duration_seconds != null ? Number(e.duration_seconds) : null,
        isRework: !!e.is_rework,
        notes: e.notes ?? null,
        inputMethod: e.input_method ?? null,
      })),
      ncrs: ncrs.map((n) => ({ id: n.id, number: n.number, title: n.title, status: String(n.status), severity: String(n.severity), createdAt: n.createdAt })),
    };
  }
}
