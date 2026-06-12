import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Not } from 'typeorm';
import { WorkOrder, WorkOrderStatus } from './work-order.entity.js';
import { WorkOrderStage, WorkOrderStageStatus } from './work-order-stage.entity.js';
import { Stage } from '../stages/stage.entity.js';
import { Ncr, NcrStatus } from '../quality-ncr/entities/ncr.entity.js';
import { AssemblyNode } from '../projects/assembly-node.entity.js';
import { inspectionGateError, isQualityStageName, qcGateMessage, InspectionSnapshot } from './qc-gate.js';
import { CreateWorkOrderDto } from './dto/create-work-order.dto.js';
import { UpdateWorkOrderDto } from './dto/update-work-order.dto.js';
import { AssignWorkOrderDto } from './dto/assign-work-order.dto.js';
import { PageOptionsDto, PageDto, PageMetaDto } from '../common/dto/pagination.dto.js';
import { AuditService } from '../audit/audit.service.js';
import { EventsGateway } from '../websocket/events.gateway.js';
import { TenantContext } from '../common/tenant/tenant-context.js';

@Injectable()
export class WorkOrdersService {
  constructor(
    @InjectRepository(WorkOrder) private readonly woRepo: Repository<WorkOrder>,
    @InjectRepository(WorkOrderStage) private readonly wosRepo: Repository<WorkOrderStage>,
    @InjectRepository(Stage) private readonly stageRepo: Repository<Stage>,
    @InjectRepository(Ncr) private readonly ncrRepo: Repository<Ncr>,
    @InjectRepository(AssemblyNode) private readonly nodeRepo: Repository<AssemblyNode>,
    private readonly auditService: AuditService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  /** Open NCRs linked to a fabricated assembly (anything not closed/cancelled blocks the quality gate). */
  private countOpenNcrs(assemblyNodeId: string): Promise<number> {
    return this.ncrRepo.count({
      where: {
        assemblyNodeId,
        status: Not(In([NcrStatus.CLOSED, NcrStatus.CANCELLED])),
        organizationId: TenantContext.getOrganizationId() ?? undefined,
      },
    });
  }

  /** Shop-floor label for a gate message: the part mark, not the internal WO number. */
  private async nodeLabel(assemblyNodeId: string, fallback: string): Promise<string> {
    const node = await this.nodeRepo.findOne({ where: { id: assemblyNodeId } });
    return node?.mark || node?.name || fallback;
  }

  /** Inspection rows (status + sign-off) for an assembly — feeds the inspection gate. */
  private async inspectionSnapshots(assemblyNodeId: string): Promise<InspectionSnapshot[]> {
    const org = TenantContext.getOrganizationId();
    const rows: { status: string; signoff_status: string | null }[] = org
      ? await this.woRepo.query(
          `SELECT status, signoff_status FROM quality_data WHERE assembly_node_id = $1 AND organization_id = $2 AND is_active = true`,
          [assemblyNodeId, org],
        )
      : await this.woRepo.query(
          `SELECT status, signoff_status FROM quality_data WHERE assembly_node_id = $1 AND is_active = true`,
          [assemblyNodeId],
        );
    return rows.map((r) => ({ status: r.status, signoffStatus: r.signoff_status }));
  }

  /**
   * Quality gate: a quality stage of a fabrication work order cannot be
   * completed while the assembly has open NCRs or unresolved failed
   * inspections; a `requiresInspection` hold-point stage additionally needs at
   * least one acceptable inspection recorded. Throws 400 when blocked.
   */
  private async assertQualityGate(
    wo: WorkOrder | null,
    stage: { name?: string | null; requiresInspection?: boolean } | null | undefined,
  ): Promise<void> {
    if (!wo?.assemblyNodeId || !isQualityStageName(stage?.name)) return;
    const open = await this.countOpenNcrs(wo.assemblyNodeId);
    if (open > 0) throw new BadRequestException(qcGateMessage(await this.nodeLabel(wo.assemblyNodeId, wo.orderNumber), open));
    const entries = await this.inspectionSnapshots(wo.assemblyNodeId);
    const err = inspectionGateError(
      await this.nodeLabel(wo.assemblyNodeId, wo.orderNumber),
      entries,
      !!stage?.requiresInspection,
    );
    if (err) throw new BadRequestException(err);
  }

  async findAll(pageOptions: PageOptionsDto, status?: string, priority?: string): Promise<PageDto<WorkOrder>> {
    const qb = this.woRepo.createQueryBuilder('wo')
      .leftJoinAndSelect('wo.process', 'process')
      .leftJoinAndSelect('wo.line', 'line')
      .orderBy('wo.createdAt', pageOptions.order)
      .skip(pageOptions.skip)
      .take(pageOptions.limit);

    if (status) qb.andWhere('wo.status = :status', { status });
    if (priority) qb.andWhere('wo.priority = :priority', { priority });
    const org = TenantContext.getOrganizationId();
    if (org) qb.andWhere('wo.organization_id = :org', { org });

    const [items, count] = await qb.getManyAndCount();
    return new PageDto(items, new PageMetaDto(pageOptions, count));
  }

  async findOne(id: string): Promise<WorkOrder> {
    const wo = await this.woRepo.findOne({
      where: { id, organizationId: TenantContext.getOrganizationId() ?? undefined },
      relations: ['process', 'line', 'stages', 'stages.stage', 'stages.assignedUser', 'stages.station'],
    });
    if (!wo) throw new NotFoundException('Work order not found');
    return wo;
  }

  /**
   * Stage kanban — the "where is every piece on the floor" view.
   *
   * Columns are the distinct process stages (ordered by sequence); each card is
   * a work order placed in the column of its FIRST INCOMPLETE stage, computed
   * live from the count-based stage rows (`qty_done`/`qty_total`) — the same
   * source of truth as the order board and the dashboard funnel. Nothing here
   * reads the legacy `work_orders.completed_quantity` column. Work orders with
   * every stage completed/skipped land in the terminal "done" list (capped).
   */
  async kanban(filters: { projectId?: string; orderId?: string; q?: string } = {}) {
    const org = TenantContext.getOrganizationId();

    // 1. Cards: every non-cancelled WO with its fabrication context.
    const params: any[] = [org];
    let where = `w.organization_id = $1 AND w.status <> 'cancelled' AND (o.id IS NULL OR o.status <> 'cancelled')`;
    if (filters.projectId) { params.push(filters.projectId); where += ` AND p.id = $${params.length}`; }
    if (filters.orderId) { params.push(filters.orderId); where += ` AND o.id = $${params.length}`; }
    if (filters.q) {
      params.push(`%${filters.q}%`);
      where += ` AND (w.order_number ILIKE $${params.length} OR n.mark ILIKE $${params.length} OR n.name ILIKE $${params.length} OR o.number ILIKE $${params.length})`;
    }
    const wos: any[] = await this.woRepo.query(
      `SELECT w.id, w.order_number, w.status, w.priority, w.due_date, w.quantity, w.updated_at,
              w.production_order_id, w.assembly_node_id,
              n.mark, n.name AS node_name, n.profile,
              o.number AS po_number, o.customer_name, o.due_date AS po_due,
              p.id AS project_id, p.name AS project_name
         FROM work_orders w
         LEFT JOIN assembly_nodes n ON n.id = w.assembly_node_id
         LEFT JOIN production_orders o ON o.id = w.production_order_id
         LEFT JOIN projects p ON p.id = o.project_id
        WHERE ${where}`,
      params,
    );
    if (wos.length === 0) {
      return { stages: [], cards: [], done: [], doneTotal: 0, totals: { active: 0, done: 0, late: 0, blocked: 0 } };
    }

    // 2. Their stage rows (single query), joined with stage/assignee/station.
    const woIds = wos.map((w) => w.id);
    const stageRows: any[] = await this.woRepo.query(
      `SELECT s.id AS wos_id, s.work_order_id, s.status, s.qty_done, s.qty_total,
              st.id AS stage_id, st.name, st.sequence, st.requires_inspection,
              u.first_name, u.last_name, sta.name AS station_name
         FROM work_order_stages s
         JOIN stages st ON st.id = s.stage_id
         LEFT JOIN users u ON u.id = s.assigned_user_id
         LEFT JOIN stations sta ON sta.id = s.station_id
        WHERE s.organization_id = $1 AND s.work_order_id = ANY($2::uuid[])
        ORDER BY st.sequence ASC, st.name ASC`,
      [org, woIds],
    );
    const stagesByWo = new Map<string, any[]>();
    for (const r of stageRows) {
      const arr = stagesByWo.get(r.work_order_id) ?? [];
      arr.push(r);
      stagesByWo.set(r.work_order_id, arr);
    }

    // 3. Quality holds per assembly (blocks the QC column's "complete").
    const nodeIds = [...new Set(wos.map((w) => w.assembly_node_id).filter(Boolean))];
    const ncrByNode = new Map<string, number>();
    if (nodeIds.length) {
      const ncrs: any[] = await this.woRepo.query(
        `SELECT assembly_node_id AS node_id, COUNT(*)::int AS open
           FROM ncrs
          WHERE organization_id = $1 AND assembly_node_id = ANY($2::uuid[])
            AND status NOT IN ('closed','cancelled')
          GROUP BY assembly_node_id`,
        [org, nodeIds],
      );
      for (const r of ncrs) ncrByNode.set(r.node_id, Number(r.open));
    }

    // Column skeleton: distinct stage names ordered by their first sequence.
    const stageCols = new Map<string, { name: string; sequence: number }>();
    for (const r of stageRows) {
      const cur = stageCols.get(r.name);
      if (!cur || Number(r.sequence) < cur.sequence) stageCols.set(r.name, { name: r.name, sequence: Number(r.sequence) });
    }
    const stages = [...stageCols.values()].sort((a, b) => a.sequence - b.sequence || a.name.localeCompare(b.name));

    const now = Date.now();
    const prioRank: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
    const cards: any[] = [];
    const done: any[] = [];

    for (const w of wos) {
      const rows = stagesByWo.get(w.id) ?? [];
      const active = rows.filter((r) => r.status !== 'skipped');
      // Overall units: count-based when stage rows carry totals (fabrication),
      // otherwise stage-count based (legacy WOs whose qty_total is null).
      const counted = active.some((r) => r.qty_total != null);
      const unitsTotal = counted
        ? active.reduce((a, r) => a + Number(r.qty_total ?? 0), 0)
        : active.length;
      const unitsDone = counted
        ? active.reduce((a, r) => a + Math.min(Number(r.qty_done ?? 0), Number(r.qty_total ?? 0)), 0)
        : active.filter((r) => r.status === 'completed').length;
      const current = active.find((r) => r.status !== 'completed') ?? null;
      const openNcrs = w.assembly_node_id ? ncrByNode.get(w.assembly_node_id) ?? 0 : 0;
      const due = w.due_date ?? w.po_due ?? null;

      const card = {
        workOrderId: w.id,
        orderNumber: w.order_number,
        woStatus: w.status,
        priority: w.priority,
        quantity: Number(w.quantity),
        mark: w.mark ?? null,
        nodeName: w.node_name ?? null,
        profile: w.profile ?? null,
        projectId: w.project_id ?? null,
        projectName: w.project_name ?? null,
        productionOrderId: w.production_order_id ?? null,
        productionOrderNumber: w.po_number ?? null,
        customerName: w.customer_name ?? null,
        dueDate: due,
        late: !!due && current != null && new Date(due).getTime() < now,
        openNcrs,
        updatedAt: w.updated_at,
        overall: {
          unitsDone,
          unitsTotal,
          percent: unitsTotal > 0 ? Math.round((unitsDone / unitsTotal) * 1000) / 10 : 0,
        },
        currentStage: current
          ? {
              wosId: current.wos_id,
              stageId: current.stage_id,
              name: current.name,
              sequence: Number(current.sequence),
              status: current.status,
              qtyDone: Number(current.qty_done ?? 0),
              qtyTotal: current.qty_total != null ? Number(current.qty_total) : null,
              assignedTo: current.first_name ? `${current.first_name} ${current.last_name ?? ''}`.trim() : null,
              station: current.station_name ?? null,
              isQuality: isQualityStageName(current.name),
              gateBlocked: isQualityStageName(current.name) && openNcrs > 0,
            }
          : null,
      };
      if (current) cards.push(card);
      else done.push(card);
    }

    cards.sort((a, b) =>
      Number(b.late) - Number(a.late)
      || (prioRank[a.priority] ?? 9) - (prioRank[b.priority] ?? 9)
      || String(a.orderNumber).localeCompare(String(b.orderNumber)));
    done.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    const totals = {
      active: cards.length,
      done: done.length,
      late: cards.filter((c) => c.late).length,
      blocked: cards.filter((c) => c.currentStage?.gateBlocked).length,
    };
    return { stages, cards, done: done.slice(0, 25), doneTotal: done.length, totals };
  }

  /** Highest numeric suffix among order numbers with the given prefix (count() drifts after deletes). */
  private async maxWoNumberSuffix(prefix: string): Promise<number> {
    const rows: { num: string }[] = await this.woRepo.query(
      `SELECT order_number AS num FROM work_orders WHERE order_number LIKE $1 ORDER BY order_number DESC LIMIT 1`,
      [`${prefix}%`],
    );
    const raw = rows?.[0]?.num;
    if (!raw) return 0;
    const n = parseInt(raw.slice(prefix.length), 10);
    return Number.isFinite(n) ? n : 0;
  }

  async create(dto: CreateWorkOrderDto): Promise<WorkOrder> {
    const year = new Date().getFullYear();

    // Retry loop handles concurrent duplicate orderNumber race condition
    let saved: WorkOrder | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      const base = await this.maxWoNumberSuffix(`WO-${year}-`);
      const orderNumber = `WO-${year}-${String(base + 1).padStart(4, '0')}`;

      try {
        const wo = this.woRepo.create({
          orderNumber,
          processId: dto.processId,
          lineId: dto.lineId || null,
          quantity: dto.quantity,
          priority: dto.priority,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        });
        saved = await this.woRepo.save(wo);
        break;
      } catch (error: any) {
        // 23505 = PostgreSQL unique_violation — another request used the same orderNumber
        if (error.code === '23505' && attempt < 4) continue;
        throw error;
      }
    }

    // Auto-create work order stages from process stages
    const stages = await this.stageRepo.find({ where: { processId: dto.processId }, order: { sequence: 'ASC' } });
    for (const stage of stages) {
      const wos = this.wosRepo.create({ workOrderId: saved!.id, stageId: stage.id });
      await this.wosRepo.save(wos);
    }

    const created = await this.findOne(saved!.id);
    this.eventsGateway.emitWorkOrderUpdate(created);
    this.eventsGateway.emitDashboardRefresh();
    return created;
  }

  async update(id: string, dto: UpdateWorkOrderDto): Promise<WorkOrder> {
    const wo = await this.findOne(id);
    if (dto.lineId !== undefined) wo.lineId = dto.lineId;
    if (dto.quantity !== undefined) wo.quantity = dto.quantity;
    if (dto.priority !== undefined) wo.priority = dto.priority;
    if (dto.dueDate !== undefined) wo.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    await this.woRepo.save(wo);
    const updated = await this.findOne(id);
    this.eventsGateway.emitWorkOrderUpdate(updated);
    return updated;
  }

  async updateStatus(id: string, newStatus: WorkOrderStatus): Promise<WorkOrder> {
    const wo = await this.findOne(id);
    const validTransitions: Record<string, string[]> = {
      draft: ['pending', 'cancelled'],
      pending: ['in_progress', 'cancelled'],
      in_progress: ['completed', 'cancelled'],
      completed: ['cancelled'],
      cancelled: [],
    };
    if (!validTransitions[wo.status]?.includes(newStatus)) {
      throw new BadRequestException(`Cannot transition from ${wo.status} to ${newStatus}`);
    }
    // Phase 7: Check dependency is completed before starting
    if (newStatus === WorkOrderStatus.IN_PROGRESS && wo.dependsOnId) {
      const dep = await this.woRepo.findOne({ where: { id: wo.dependsOnId } });
      if (dep && dep.status !== WorkOrderStatus.COMPLETED) {
        throw new BadRequestException(`Cannot start: depends on ${dep.orderNumber} which is not completed`);
      }
    }

    // Quality gate: completing the whole WO cascades every stage (incl. quality)
    // to completed — blocked while the fabricated assembly has open NCRs,
    // unresolved failed inspections, or an unsatisfied inspection hold point.
    if (newStatus === WorkOrderStatus.COMPLETED && wo.assemblyNodeId) {
      const open = await this.countOpenNcrs(wo.assemblyNodeId);
      if (open > 0) throw new BadRequestException(qcGateMessage(await this.nodeLabel(wo.assemblyNodeId, wo.orderNumber), open));
      const qualityStages = wo.processId
        ? await this.stageRepo.find({ where: { processId: wo.processId } })
        : [];
      const quality = qualityStages.filter((s) => isQualityStageName(s.name));
      if (quality.length) {
        const entries = await this.inspectionSnapshots(wo.assemblyNodeId);
        const err = inspectionGateError(
          await this.nodeLabel(wo.assemblyNodeId, wo.orderNumber),
          entries,
          quality.some((s) => s.requiresInspection),
        );
        if (err) throw new BadRequestException(err);
      }
    }

    const oldStatus = wo.status;
    wo.status = newStatus;
    const now = new Date();
    if (newStatus === WorkOrderStatus.IN_PROGRESS) wo.startedAt = now;
    if (newStatus === WorkOrderStatus.COMPLETED) wo.completedAt = now;
    await this.woRepo.save(wo);

    // Cascade status to stages
    if (newStatus === WorkOrderStatus.COMPLETED) {
      const stages = await this.wosRepo.find({ where: { workOrderId: id } });
      for (const stage of stages) {
        if (stage.status !== WorkOrderStageStatus.COMPLETED && stage.status !== WorkOrderStageStatus.SKIPPED) {
          stage.status = WorkOrderStageStatus.COMPLETED;
          stage.completedAt = stage.completedAt || now;
          await this.wosRepo.save(stage);
        }
      }
    } else if (newStatus === WorkOrderStatus.CANCELLED) {
      const stages = await this.wosRepo.find({ where: { workOrderId: id } });
      for (const stage of stages) {
        if (stage.status === WorkOrderStageStatus.IN_PROGRESS) {
          stage.status = WorkOrderStageStatus.PENDING;
          await this.wosRepo.save(stage);
        }
      }
    }

    // Phase 12: Audit log
    await this.auditService.log({
      action: 'status_change',
      entityType: 'work_order',
      entityId: id,
      oldValues: { status: oldStatus },
      newValues: { status: newStatus },
    });

    const updated = await this.findOne(id);
    this.eventsGateway.emitWorkOrderUpdate(updated);
    this.eventsGateway.emitDashboardRefresh();
    return updated;
  }

  // Phase 7: Batch status update
  async batchUpdateStatus(ids: string[], newStatus: WorkOrderStatus): Promise<{ updated: number; errors: string[] }> {
    const errors: string[] = [];
    let updated = 0;
    for (const id of ids) {
      try {
        await this.updateStatus(id, newStatus);
        updated++;
      } catch (e: any) {
        errors.push(`${id}: ${e.message}`);
      }
    }
    return { updated, errors };
  }

  // Phase 7: Batch assign to line
  async batchAssignLine(ids: string[], lineId: string): Promise<number> {
    const result = await this.woRepo.update({ id: In(ids) }, { lineId });
    this.eventsGateway.emitWorkOrderUpdate({ ids, lineId });
    return result.affected || 0;
  }

  async updateStageStatus(workOrderId: string, stageId: string, newStatus: WorkOrderStageStatus): Promise<WorkOrder> {
    const wos = await this.wosRepo.findOne({ where: { id: stageId, workOrderId }, relations: ['stage'] });
    if (!wos) throw new NotFoundException('Work order stage not found');

    // Quality gate: a quality stage can't be completed while the assembly has open NCRs.
    if (newStatus === WorkOrderStageStatus.COMPLETED && wos.status !== WorkOrderStageStatus.COMPLETED) {
      const wo = await this.woRepo.findOne({ where: { id: workOrderId } });
      await this.assertQualityGate(wo, wos.stage);
    }

    const now = new Date();
    wos.status = newStatus;
    if (newStatus === WorkOrderStageStatus.IN_PROGRESS && !wos.startedAt) {
      wos.startedAt = now;
    }
    if (newStatus === WorkOrderStageStatus.COMPLETED) {
      wos.completedAt = now;
      if (wos.startedAt) {
        wos.actualTimeSeconds = Math.round((now.getTime() - new Date(wos.startedAt).getTime()) / 1000);
      }
    }
    if (newStatus === WorkOrderStageStatus.PENDING) {
      wos.startedAt = null;
      wos.completedAt = null;
      wos.actualTimeSeconds = null;
    }
    await this.wosRepo.save(wos);

    await this.auditService.log({
      action: 'stage_status_change',
      entityType: 'work_order_stage',
      entityId: stageId,
      oldValues: {},
      newValues: { status: newStatus },
    });

    const updated = await this.findOne(workOrderId);
    this.eventsGateway.emitWorkOrderUpdate(updated);
    return updated;
  }

  async assign(id: string, dto: AssignWorkOrderDto): Promise<WorkOrder> {
    for (const assignment of dto.assignments) {
      const wos = await this.wosRepo.findOne({ where: { workOrderId: id, stageId: assignment.stageId } });
      if (!wos) throw new NotFoundException(`Work order stage not found for stageId ${assignment.stageId}`);
      wos.assignedUserId = assignment.userId;
      if (assignment.stationId) wos.stationId = assignment.stationId;
      await this.wosRepo.save(wos);
    }
    const updated = await this.findOne(id);
    this.eventsGateway.emitWorkOrderUpdate(updated);
    return updated;
  }
}
