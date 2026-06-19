import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { TimeEntry, InputMethod } from './time-entry.entity.js';
import { WorkOrderStage, WorkOrderStageStatus } from '../work-orders/work-order-stage.entity.js';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { User } from '../auth/entities/user.entity.js';
import { Station } from '../stations/station.entity.js';
import { Organization } from '../organization/organization.entity.js';
import { ClockInDto } from './dto/clock-in.dto.js';
import { ClockOutDto } from './dto/clock-out.dto.js';
import { CreateTimeEntryDto } from './dto/create-time-entry.dto.js';
import { UpdateTimeEntryDto } from './dto/update-time-entry.dto.js';
import { PageOptionsDto, PageDto, PageMetaDto } from '../common/dto/pagination.dto.js';
import { EventsGateway } from '../websocket/events.gateway.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { resolveRate, normalizeSettings, round2 } from '../costing/costing-math.js';

/**
 * Time tracking is the labor/machine ledger that feeds costing. Every entry ties
 * a worker → a work-order STAGE → (via the work order) an ASSEMBLY, so "who spent
 * how long on which assembly + stage" is the natural grain. Entries can be:
 *   - clocked live (clock-in / clock-out), or
 *   - logged/corrected manually (create / update / remove) by a supervisor.
 *
 * Two deliberate rules keep it honest:
 *   1. Logging time is DECOUPLED from stage completion — the count-based board
 *      drives status; clocking out just records labor and accumulates the stage's
 *      actual time. (The old behaviour force-completed the whole stage on
 *      clock-out, which was wrong whenever a stage still had units in progress.)
 *   2. Labor + machine rates are FROZEN onto the row at clock-out / create / on a
 *      reassigning edit (worker → stage standard; the org default stays a live
 *      read-time fallback). Costing reads the stamped rate, so a later rate change
 *      never rewrites history.
 */
@Injectable()
export class TimeTrackingService {
  constructor(
    @InjectRepository(TimeEntry) private readonly teRepo: Repository<TimeEntry>,
    @InjectRepository(WorkOrderStage) private readonly wosRepo: Repository<WorkOrderStage>,
    @InjectRepository(WorkOrder) private readonly woRepo: Repository<WorkOrder>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Station) private readonly stationRepo: Repository<Station>,
    @InjectRepository(Organization) private readonly orgRepo: Repository<Organization>,
    private readonly eventsGateway: EventsGateway,
  ) {}

  private readonly logger = new Logger(TimeTrackingService.name);

  private get org(): string { return TenantContext.requireOrganizationId(); }

  // ── Live clock-in / clock-out ────────────────────────────────────────────────

  async clockIn(userId: string, dto: ClockInDto): Promise<TimeEntry> {
    const active = await this.teRepo.findOne({ where: { userId, endTime: IsNull() } });
    if (active) throw new BadRequestException('User already has an active time entry');

    const wos = await this.loadStage(dto.workOrderStageId);
    if (dto.stationId) await this.assertStation(dto.stationId);

    // Mark the stage started so the board reflects activity — but never complete it
    // here (completion is count-driven on the board, not a side effect of logging).
    if (wos.status === WorkOrderStageStatus.PENDING) wos.status = WorkOrderStageStatus.IN_PROGRESS;
    wos.startedAt = wos.startedAt || new Date();
    await this.wosRepo.save(wos);

    const entry = this.teRepo.create({
      userId,
      workOrderStageId: dto.workOrderStageId,
      stationId: dto.stationId || null,
      inputMethod: dto.inputMethod ?? InputMethod.WEB,
      isSetup: dto.isSetup ?? false,
      startTime: new Date(),
    });
    const saved = await this.teRepo.save(entry);
    const result = await this.reload(saved.id);

    this.eventsGateway.emitTimeEntryUpdate(result, this.org);
    this.eventsGateway.emitStageUpdate(wos, this.org);
    this.eventsGateway.emitDashboardRefresh(this.org);
    return result;
  }

  async clockOut(_userId: string, dto: ClockOutDto): Promise<TimeEntry> {
    const entry = await this.reload(dto.timeEntryId);
    if (entry.endTime) throw new BadRequestException('Time entry already clocked out');

    entry.endTime = new Date();
    entry.durationSeconds = Math.round((entry.endTime.getTime() - entry.startTime.getTime()) / 1000);
    if (dto.notes) entry.notes = dto.notes;
    this.freezeRates(entry, entry.user, entry.workOrderStage?.stage, entry.station);
    await this.teRepo.save(entry);

    // Accumulate the stage's actual time from the ledger (idempotent) — do NOT
    // complete the stage; counts drive completion on the board.
    await this.recomputeStageActual(entry.workOrderStageId);
    const wos = await this.wosRepo.findOne({ where: { id: entry.workOrderStageId } });
    if (wos) this.eventsGateway.emitStageUpdate(wos, this.org);

    const result = await this.reload(entry.id);
    this.eventsGateway.emitTimeEntryUpdate(result, this.org);
    this.eventsGateway.emitDashboardRefresh(this.org);
    return result;
  }

  // ── Manual create / update / delete ──────────────────────────────────────────

  /** Manually log a (possibly retroactive) time record against a stage. */
  async create(dto: CreateTimeEntryDto): Promise<TimeEntry> {
    const wos = await this.loadStage(dto.workOrderStageId);
    const user = await this.assertUser(dto.userId);
    const station = dto.stationId ? await this.assertStation(dto.stationId) : null;

    const start = new Date(dto.startTime);
    if (isNaN(start.getTime())) throw new BadRequestException('Invalid startTime');
    let end: Date | null = null;
    let duration: number | null = null;
    if (dto.endTime) {
      end = new Date(dto.endTime);
      if (isNaN(end.getTime())) throw new BadRequestException('Invalid endTime');
      if (end.getTime() < start.getTime()) throw new BadRequestException('endTime must be after startTime');
      duration = Math.round((end.getTime() - start.getTime()) / 1000);
    } else if (dto.durationSeconds != null) {
      duration = Math.max(0, Math.round(dto.durationSeconds));
      end = new Date(start.getTime() + duration * 1000);
    } else {
      throw new BadRequestException('Provide either endTime or durationSeconds');
    }
    if (dto.breakSeconds != null && duration != null && dto.breakSeconds > duration) {
      throw new BadRequestException('Break cannot exceed the worked duration');
    }

    const entry = this.teRepo.create({
      userId: dto.userId,
      workOrderStageId: dto.workOrderStageId,
      stationId: station?.id ?? null,
      startTime: start,
      endTime: end,
      durationSeconds: duration,
      breakSeconds: dto.breakSeconds ?? 0,
      idleSeconds: dto.idleSeconds ?? 0,
      isSetup: dto.isSetup ?? false,
      isRework: dto.isRework ?? false,
      notes: dto.notes ?? null,
      inputMethod: dto.inputMethod ?? InputMethod.WEB,
    });
    this.freezeRates(entry, user, wos.stage, station);
    const saved = await this.teRepo.save(entry);

    // Logging time against a pending stage starts it (count-driven completion stays on the board).
    if (wos.status === WorkOrderStageStatus.PENDING) {
      wos.status = WorkOrderStageStatus.IN_PROGRESS;
      wos.startedAt = wos.startedAt || start;
      await this.wosRepo.save(wos);
    }
    await this.recomputeStageActual(dto.workOrderStageId);

    const result = await this.reload(saved.id);
    this.eventsGateway.emitTimeEntryUpdate(result, this.org);
    this.eventsGateway.emitStageUpdate(await this.wosRepo.findOne({ where: { id: dto.workOrderStageId } }), this.org);
    this.eventsGateway.emitDashboardRefresh(this.org);
    return result;
  }

  async update(id: string, dto: UpdateTimeEntryDto): Promise<TimeEntry> {
    const entry = await this.teRepo.findOne({ where: { id, organizationId: this.org } });
    if (!entry) throw new NotFoundException('Time entry not found');
    const previousStageId = entry.workOrderStageId;

    if (dto.userId !== undefined) { await this.assertUser(dto.userId); entry.userId = dto.userId; }
    if (dto.workOrderStageId !== undefined) { await this.loadStage(dto.workOrderStageId); entry.workOrderStageId = dto.workOrderStageId; }
    if (dto.stationId !== undefined) {
      if (dto.stationId) await this.assertStation(dto.stationId);
      entry.stationId = dto.stationId || null;
    }
    if (dto.startTime) entry.startTime = new Date(dto.startTime);
    if (dto.endTime !== undefined) entry.endTime = dto.endTime ? new Date(dto.endTime) : null;
    // Recompute duration from end−start when we have both, else honour an explicit override.
    if (entry.endTime) {
      if (entry.endTime.getTime() < entry.startTime.getTime()) throw new BadRequestException('End time must be after start time');
      entry.durationSeconds = Math.round((entry.endTime.getTime() - entry.startTime.getTime()) / 1000);
    } else if (dto.durationSeconds != null) {
      entry.durationSeconds = Math.max(0, Math.round(dto.durationSeconds));
    }
    if (dto.breakSeconds !== undefined) entry.breakSeconds = dto.breakSeconds;
    if (dto.idleSeconds !== undefined) entry.idleSeconds = dto.idleSeconds;
    if (dto.isSetup !== undefined) entry.isSetup = dto.isSetup;
    if (dto.isRework !== undefined) entry.isRework = dto.isRework;
    if (dto.notes !== undefined) entry.notes = dto.notes;
    if (entry.breakSeconds && entry.durationSeconds != null && entry.breakSeconds > entry.durationSeconds) {
      throw new BadRequestException('Break cannot exceed the worked duration');
    }

    // Re-freeze rates when the assignment (worker / stage / station) changed, or
    // when the row never got a rate (so configuring rates later + a touch-up applies them).
    const assignmentTouched = dto.userId !== undefined || dto.workOrderStageId !== undefined || dto.stationId !== undefined;
    if (assignmentTouched || entry.laborRate == null) {
      const [user, wos, station] = await Promise.all([
        this.userRepo.findOne({ where: { id: entry.userId } }),
        this.wosRepo.findOne({ where: { id: entry.workOrderStageId }, relations: ['stage'] }),
        entry.stationId ? this.stationRepo.findOne({ where: { id: entry.stationId } }) : Promise.resolve(null),
      ]);
      this.freezeRates(entry, user, wos?.stage, station);
    }
    await this.teRepo.save(entry);

    // Keep both the old and the new stage's accumulated actual time in step.
    if (previousStageId !== entry.workOrderStageId) await this.recomputeStageActual(previousStageId);
    await this.recomputeStageActual(entry.workOrderStageId);

    const result = await this.reload(id);
    this.eventsGateway.emitTimeEntryUpdate(result, this.org);
    this.eventsGateway.emitDashboardRefresh(this.org);
    return result;
  }

  async remove(id: string): Promise<{ id: string; deleted: true }> {
    const entry = await this.teRepo.findOne({ where: { id, organizationId: this.org } });
    if (!entry) throw new NotFoundException('Time entry not found');
    const stageId = entry.workOrderStageId;
    await this.teRepo.remove(entry);
    await this.recomputeStageActual(stageId);
    this.eventsGateway.emitTimeEntryUpdate({ id, deleted: true }, this.org);
    this.eventsGateway.emitStageUpdate(await this.wosRepo.findOne({ where: { id: stageId } }), this.org);
    this.eventsGateway.emitDashboardRefresh(this.org);
    return { id, deleted: true };
  }

  // ── Reads ────────────────────────────────────────────────────────────────────

  async getActive(): Promise<any[]> {
    try {
      const qb = this.teRepo.createQueryBuilder('te')
        .leftJoin('te.user', 'user')
        .leftJoin('te.station', 'station')
        .leftJoin('te.workOrderStage', 'wos')
        .leftJoin('wos.stage', 'stage')
        .leftJoin('wos.workOrder', 'wo')
        .select('te.id', 'id')
        .addSelect('te.start_time', 'startTime')
        .addSelect('te.user_id', 'userId')
        .addSelect('te.work_order_stage_id', 'workOrderStageId')
        .addSelect('user.first_name', 'firstName')
        .addSelect('user.last_name', 'lastName')
        .addSelect('station.name', 'stationName')
        .addSelect('stage.name', 'stageName')
        .addSelect('wo.id', 'workOrderId')
        .addSelect('wo.order_number', 'orderNumber')
        .where('te.end_time IS NULL')
        .orderBy('te.start_time', 'ASC');
      const org = TenantContext.getOrganizationId();
      if (org) qb.andWhere('te.organization_id = :org', { org });
      const rows = await qb.getRawMany();

      return rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        workOrderStageId: r.workOrderStageId,
        startTime: r.startTime,
        elapsedSeconds: r.startTime ? Math.round((Date.now() - new Date(r.startTime).getTime()) / 1000) : 0,
        user: { firstName: r.firstName, lastName: r.lastName },
        station: r.stationName ? { name: r.stationName } : null,
        workOrderStage: {
          stage: r.stageName ? { name: r.stageName } : null,
          workOrder: r.orderNumber ? { id: r.workOrderId, orderNumber: r.orderNumber } : null,
        },
      }));
    } catch (err) {
      this.logger.error(`getActive failed: ${(err as Error).message}`);
      return [];
    }
  }

  async getHistory(pageOptions: PageOptionsDto, userId?: string, workOrderId?: string, startDate?: string, endDate?: string): Promise<PageDto<TimeEntry>> {
    const parseDate = (v: string | undefined, name: string): Date | undefined => {
      if (!v) return undefined;
      const d = new Date(v);
      if (isNaN(d.getTime())) throw new BadRequestException(`Invalid ${name}: '${v}'`);
      return d;
    };
    const start = parseDate(startDate, 'startDate');
    const end = parseDate(endDate, 'endDate');

    const qb = this.teRepo.createQueryBuilder('te')
      .leftJoinAndSelect('te.user', 'user')
      .leftJoinAndSelect('te.workOrderStage', 'wos')
      .leftJoinAndSelect('wos.stage', 'stage')
      .leftJoinAndSelect('wos.workOrder', 'wo')
      .leftJoinAndSelect('te.station', 'station')
      .orderBy('te.startTime', 'DESC')
      .skip(pageOptions.skip)
      .take(pageOptions.limit);

    if (userId) qb.andWhere('te.user_id = :userId', { userId });
    if (workOrderId) qb.andWhere('wos.work_order_id = :workOrderId', { workOrderId });
    if (start) qb.andWhere('te.start_time >= :startDate', { startDate: start });
    if (end) qb.andWhere('te.start_time <= :endDate', { endDate: end });
    const histOrg = TenantContext.getOrganizationId();
    if (histOrg) qb.andWhere('te.organization_id = :histOrg', { histOrg });

    const [items, count] = await qb.getManyAndCount();
    return new PageDto(items, new PageMetaDto(pageOptions, count));
  }

  async getByUser(userId: string): Promise<TimeEntry[]> {
    return this.teRepo.find({
      where: { userId, organizationId: TenantContext.getOrganizationId() ?? undefined },
      relations: ['workOrderStage', 'workOrderStage.stage', 'station'],
      order: { startTime: 'DESC' },
    });
  }

  // ── Per-work-order summary (the heart of the reimagined page) ─────────────────

  /**
   * Everything the time console needs for one work order: the stage rows with
   * logged time + per-stage labor/machine cost, a per-worker rollup, and the full
   * editable entry list. Costs use the SAME rate chain as costing
   * (stamped → worker → stage → org default) so the numbers agree.
   */
  async workOrderSummary(workOrderId: string) {
    const org = this.org;
    const wo = await this.woRepo.findOne({ where: { id: workOrderId, organizationId: org } as any, relations: ['assemblyNode'] });
    if (!wo) throw new NotFoundException('Work order not found');
    const { defaultRate, currency } = await this.costingDefaults();

    const paid = `GREATEST(COALESCE(te.duration_seconds, 0) - COALESCE(te.break_seconds, 0), 0)`;
    const laborRate = `COALESCE(NULLIF(te.labor_rate, 0), NULLIF(u.hourly_rate, 0), NULLIF(st.hourly_rate, 0), $3)`;
    const machineRate = `COALESCE(NULLIF(te.machine_rate, 0), NULLIF(stn.machine_rate, 0), 0)`;

    const [stageRows, workerRows, entryRows] = await Promise.all([
      this.teRepo.query(
        `SELECT s.id AS wos_id, s.stage_id, s.status, s.qty_done, s.qty_total,
                st.name AS stage_name, st.sequence, st.target_time_seconds,
                COALESCE(SUM(${paid}), 0)::bigint AS seconds,
                COUNT(te.id)::int AS entries,
                COALESCE(SUM(${paid} / 3600.0 * ${laborRate}), 0) AS labor_cost,
                COALESCE(SUM(${paid} / 3600.0 * ${machineRate}), 0) AS machine_cost,
                COALESCE(SUM(CASE WHEN te.is_setup AND NOT te.is_rework THEN ${paid} ELSE 0 END), 0)::bigint AS setup_seconds,
                COALESCE(SUM(CASE WHEN te.is_rework THEN ${paid} ELSE 0 END), 0)::bigint AS rework_seconds
           FROM work_order_stages s
           LEFT JOIN stages st ON st.id = s.stage_id
           LEFT JOIN time_entries te ON te.work_order_stage_id = s.id AND te.organization_id = $1
           LEFT JOIN users u ON u.id = te.user_id
           LEFT JOIN stations stn ON stn.id = te.station_id
          WHERE s.work_order_id = $2 AND s.organization_id = $1
          GROUP BY s.id, s.stage_id, s.status, s.qty_done, s.qty_total, st.name, st.sequence, st.target_time_seconds
          ORDER BY st.sequence NULLS LAST, st.name`,
        [org, workOrderId, defaultRate],
      ),
      this.teRepo.query(
        `SELECT u.id, u.first_name, u.last_name,
                COALESCE(SUM(${paid}), 0)::bigint AS seconds,
                COUNT(te.id)::int AS entries,
                COALESCE(SUM(${paid} / 3600.0 * ${laborRate}), 0) AS cost
           FROM time_entries te
           JOIN work_order_stages s ON s.id = te.work_order_stage_id
           LEFT JOIN stages st ON st.id = s.stage_id
           LEFT JOIN users u ON u.id = te.user_id
          WHERE te.organization_id = $1 AND s.work_order_id = $2
          GROUP BY u.id, u.first_name, u.last_name
          ORDER BY cost DESC`,
        [org, workOrderId, defaultRate],
      ),
      this.teRepo.query(
        `SELECT te.id, te.user_id, te.work_order_stage_id, te.station_id,
                te.start_time, te.end_time, te.duration_seconds, te.break_seconds, te.idle_seconds,
                te.is_setup, te.is_rework, te.labor_rate, te.machine_rate, te.input_method, te.notes,
                u.first_name, u.last_name, st.name AS stage_name, st.sequence, sta.name AS station_name
           FROM time_entries te
           JOIN work_order_stages s ON s.id = te.work_order_stage_id
           LEFT JOIN stages st ON st.id = s.stage_id
           LEFT JOIN users u ON u.id = te.user_id
           LEFT JOIN stations sta ON sta.id = te.station_id
          WHERE te.organization_id = $1 AND s.work_order_id = $2
          ORDER BY te.start_time DESC`,
        [org, workOrderId],
      ),
    ]);

    const stages = (stageRows as any[]).map((r) => ({
      workOrderStageId: r.wos_id,
      stageId: r.stage_id,
      name: r.stage_name ?? 'Stage',
      sequence: Number(r.sequence ?? 0),
      status: String(r.status),
      qtyDone: Number(r.qty_done ?? 0),
      qtyTotal: r.qty_total == null ? null : Number(r.qty_total),
      targetTimeSeconds: r.target_time_seconds == null ? null : Number(r.target_time_seconds),
      loggedSeconds: Number(r.seconds),
      setupSeconds: Number(r.setup_seconds),
      reworkSeconds: Number(r.rework_seconds),
      entries: Number(r.entries),
      laborCost: round2(Number(r.labor_cost)),
      machineCost: round2(Number(r.machine_cost)),
    }));
    const workers = (workerRows as any[]).map((r) => ({
      userId: r.id,
      name: [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Unknown',
      seconds: Number(r.seconds),
      hours: round2(Number(r.seconds) / 3600),
      entries: Number(r.entries),
      cost: round2(Number(r.cost)),
    }));
    const entries = (entryRows as any[]).map(this.mapEntryRow);

    const laborSeconds = stages.reduce((s, r) => s + r.loggedSeconds, 0);
    const laborCost = round2(stages.reduce((s, r) => s + r.laborCost, 0));
    const machineCost = round2(stages.reduce((s, r) => s + r.machineCost, 0));
    const machineSeconds = entries.filter((e) => (e.machineRate ?? 0) > 0).reduce((s, e) => s + Math.max(0, (e.durationSeconds ?? 0) - (e.breakSeconds ?? 0)), 0);

    return {
      workOrderId,
      orderNumber: wo.orderNumber,
      mark: wo.assemblyNode?.mark || wo.assemblyNode?.name || wo.orderNumber,
      status: String(wo.status),
      productionOrderId: wo.productionOrderId,
      assemblyNodeId: wo.assemblyNodeId,
      currency,
      defaultLaborRate: defaultRate,
      totals: {
        laborSeconds,
        laborHours: round2(laborSeconds / 3600),
        laborCost,
        machineSeconds,
        machineHours: round2(machineSeconds / 3600),
        machineCost,
        entries: entries.length,
      },
      stages,
      workers,
      entries,
    };
  }

  /** Per-work-order clocked rollup for every work order on a production order (the order Time tab). */
  async orderWorkOrders(orderId: string) {
    const org = this.org;
    const { defaultRate, currency } = await this.costingDefaults();
    const paid = `GREATEST(COALESCE(te.duration_seconds, 0) - COALESCE(te.break_seconds, 0), 0)`;
    const laborRate = `COALESCE(NULLIF(te.labor_rate, 0), NULLIF(u.hourly_rate, 0), NULLIF(st.hourly_rate, 0), $3)`;
    const machineRate = `COALESCE(NULLIF(te.machine_rate, 0), NULLIF(stn.machine_rate, 0), 0)`;
    const rows: any[] = await this.woRepo.query(
      `SELECT w.id AS wo_id, w.order_number, w.status,
              n.mark, n.name AS node_name,
              COALESCE(SUM(${paid}), 0)::bigint AS seconds,
              COUNT(te.id)::int AS entries,
              COUNT(DISTINCT te.user_id)::int AS workers,
              COALESCE(SUM(${paid} / 3600.0 * ${laborRate}), 0) AS labor_cost,
              COALESCE(SUM(${paid} / 3600.0 * ${machineRate}), 0) AS machine_cost
         FROM work_orders w
         LEFT JOIN work_order_stages s ON s.work_order_id = w.id
         LEFT JOIN time_entries te ON te.work_order_stage_id = s.id AND te.organization_id = $1
         LEFT JOIN stages st ON st.id = s.stage_id
         LEFT JOIN users u ON u.id = te.user_id
         LEFT JOIN stations stn ON stn.id = te.station_id
         LEFT JOIN assembly_nodes n ON n.id = w.assembly_node_id
        WHERE w.production_order_id = $2 AND w.organization_id = $1
        GROUP BY w.id, w.order_number, w.status, n.mark, n.name`,
      [org, orderId, defaultRate],
    );
    const workOrders = rows
      .map((r) => ({
        workOrderId: r.wo_id,
        orderNumber: r.order_number,
        mark: r.mark || r.node_name || r.order_number,
        status: String(r.status),
        loggedSeconds: Number(r.seconds),
        loggedHours: round2(Number(r.seconds) / 3600),
        entries: Number(r.entries),
        workers: Number(r.workers),
        laborCost: round2(Number(r.labor_cost)),
        machineCost: round2(Number(r.machine_cost)),
      }))
      .sort((a, b) => b.loggedSeconds - a.loggedSeconds || a.mark.localeCompare(b.mark, undefined, { numeric: true }));

    return {
      orderId,
      currency,
      totals: {
        laborSeconds: workOrders.reduce((s, w) => s + w.loggedSeconds, 0),
        laborHours: round2(workOrders.reduce((s, w) => s + w.loggedHours, 0)),
        laborCost: round2(workOrders.reduce((s, w) => s + w.laborCost, 0)),
        machineCost: round2(workOrders.reduce((s, w) => s + w.machineCost, 0)),
        entries: workOrders.reduce((s, w) => s + w.entries, 0),
      },
      workOrders,
    };
  }

  // ── Live factory-floor status ────────────────────────────────────────────────

  /**
   * A real-time picture of the shop floor: who is clocked in right now (and on
   * which assembly / stage / station / line), how each station is occupied, and
   * headline KPIs. Feeds the console's "Floor — Live" board (auto-refreshing).
   */
  async floorStatus() {
    const org = this.org;
    const [sessionRows, stationRows] = await Promise.all([
      this.teRepo.query(
        `SELECT te.id, te.user_id, te.start_time, te.is_setup, te.is_rework, te.station_id,
                u.first_name, u.last_name,
                st.name AS stage_name,
                wo.id AS wo_id, wo.order_number,
                n.mark, n.name AS node_name,
                sta.name AS station_name, ln.name AS line_name
           FROM time_entries te
           LEFT JOIN users u ON u.id = te.user_id
           LEFT JOIN work_order_stages s ON s.id = te.work_order_stage_id
           LEFT JOIN stages st ON st.id = s.stage_id
           LEFT JOIN work_orders wo ON wo.id = s.work_order_id
           LEFT JOIN assembly_nodes n ON n.id = wo.assembly_node_id
           LEFT JOIN stations sta ON sta.id = te.station_id
           LEFT JOIN lines ln ON ln.id = sta.line_id
          WHERE te.end_time IS NULL AND te.organization_id = $1
          ORDER BY te.start_time ASC`,
        [org],
      ),
      this.teRepo.query(
        `SELECT sta.id, sta.name, sta.machine_rate, ln.name AS line_name,
                EXISTS(
                  SELECT 1 FROM time_entries te
                   WHERE te.station_id = sta.id AND te.end_time IS NULL AND te.organization_id = $1
                ) AS busy
           FROM stations sta
           LEFT JOIN lines ln ON ln.id = sta.line_id
          WHERE sta.organization_id = $1 AND sta.is_active = true
          ORDER BY ln.name NULLS LAST, sta.name`,
        [org],
      ),
    ]);

    const now = Date.now();
    const sessions = (sessionRows as any[]).map((r) => ({
      id: r.id,
      userId: r.user_id,
      userName: [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Unknown',
      stageName: r.stage_name ?? null,
      workOrderId: r.wo_id ?? null,
      orderNumber: r.order_number ?? null,
      mark: r.mark || r.node_name || null,
      stationId: r.station_id ?? null,
      stationName: r.station_name ?? null,
      lineName: r.line_name ?? null,
      isSetup: !!r.is_setup,
      isRework: !!r.is_rework,
      startTime: r.start_time,
      elapsedSeconds: r.start_time ? Math.round((now - new Date(r.start_time).getTime()) / 1000) : 0,
    }));
    const sessionByStation = new Map<string, any>();
    for (const s of sessions) if (s.stationId && !sessionByStation.has(s.stationId)) sessionByStation.set(s.stationId, s);

    const stations = (stationRows as any[]).map((r) => {
      const s = sessionByStation.get(r.id);
      return {
        id: r.id,
        name: r.name,
        lineName: r.line_name ?? null,
        hasMachineRate: Number(r.machine_rate) > 0,
        busy: !!r.busy,
        session: s ? { userName: s.userName, stageName: s.stageName, orderNumber: s.orderNumber, mark: s.mark, elapsedSeconds: s.elapsedSeconds } : null,
      };
    });

    const busyStations = stations.filter((s) => s.busy).length;
    return {
      generatedAt: new Date().toISOString(),
      kpis: {
        activeOperators: new Set(sessions.map((s) => s.userId)).size,
        activeSessions: sessions.length,
        activeWorkOrders: new Set(sessions.map((s) => s.workOrderId).filter(Boolean)).size,
        stations: stations.length,
        busyStations,
        idleStations: stations.length - busyStations,
      },
      sessions,
      stations,
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private mapEntryRow = (r: any) => ({
    id: r.id,
    userId: r.user_id,
    userName: [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Unknown',
    workOrderStageId: r.work_order_stage_id,
    stageName: r.stage_name ?? null,
    sequence: Number(r.sequence ?? 0),
    stationId: r.station_id,
    stationName: r.station_name ?? null,
    startTime: r.start_time,
    endTime: r.end_time,
    durationSeconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
    breakSeconds: Number(r.break_seconds ?? 0),
    idleSeconds: Number(r.idle_seconds ?? 0),
    isSetup: !!r.is_setup,
    isRework: !!r.is_rework,
    laborRate: r.labor_rate == null ? null : Number(r.labor_rate),
    machineRate: r.machine_rate == null ? null : Number(r.machine_rate),
    inputMethod: r.input_method,
    notes: r.notes ?? null,
  });

  /** Freeze the worker→stage labor rate and the station machine rate onto the entry. */
  private freezeRates(entry: TimeEntry, user?: User | null, stage?: { hourlyRate?: number | null } | null, station?: Station | null): void {
    const labor = resolveRate(user?.hourlyRate, stage?.hourlyRate ?? null, 0);
    entry.laborRate = labor > 0 ? labor : null;
    const machine = Number(station?.machineRate) || 0;
    entry.machineRate = machine > 0 ? machine : null;
  }

  /** Recompute a stage's denormalized actual_time_seconds from the ledger (idempotent). */
  private async recomputeStageActual(workOrderStageId: string): Promise<void> {
    const row = await this.teRepo.createQueryBuilder('te')
      .select('COALESCE(SUM(te.duration_seconds), 0)', 'sum')
      .where('te.work_order_stage_id = :id', { id: workOrderStageId })
      .getRawOne<{ sum: string }>();
    const seconds = Number(row?.sum ?? 0);
    await this.wosRepo.update({ id: workOrderStageId }, { actualTimeSeconds: seconds > 0 ? seconds : null });
  }

  private async loadStage(workOrderStageId: string): Promise<WorkOrderStage> {
    const wos = await this.wosRepo.findOne({ where: { id: workOrderStageId, organizationId: this.org } as any, relations: ['stage'] });
    if (!wos) throw new NotFoundException('Work order stage not found');
    return wos;
  }

  private async assertUser(userId: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id: userId, organizationId: this.org } as any });
    if (!user) throw new NotFoundException('User not found in this organization');
    return user;
  }

  private async assertStation(stationId: string): Promise<Station> {
    const station = await this.stationRepo.findOne({ where: { id: stationId, organizationId: this.org } as any });
    if (!station) throw new NotFoundException('Station not found in this organization');
    return station;
  }

  private async reload(id: string): Promise<TimeEntry> {
    const entry = await this.teRepo.findOne({ where: { id }, relations: ['user', 'workOrderStage', 'workOrderStage.stage', 'station'] });
    if (!entry) throw new NotFoundException('Time entry not found');
    return entry;
  }

  private async costingDefaults(): Promise<{ defaultRate: number; currency: string }> {
    const o = await this.orgRepo.findOne({ where: { id: this.org } });
    const s = normalizeSettings((o?.settings as any)?.costing, (o?.settings as any)?.laborHourlyRate);
    return { defaultRate: s.defaultLaborRate, currency: s.currency };
  }
}
