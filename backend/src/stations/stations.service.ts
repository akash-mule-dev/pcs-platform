import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DeepPartial } from 'typeorm';
import { Station, StationStatus } from './station.entity.js';
import { Line } from '../lines/line.entity.js';
import { CreateStationDto } from './dto/create-station.dto.js';
import { UpdateStationDto } from './dto/update-station.dto.js';
import { TenantScopedService } from '../common/tenant/tenant-scoped.service.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { EventsGateway } from '../websocket/events.gateway.js';
import { composeStationUtilization, withoutCost, windowDaysInclusive } from './station-utilization-math.js';

/**
 * Work-center (station) service. CRUD plus the station-keyed aggregates that
 * power the directory + per-station cockpit:
 *   - list()        — org-wide directory rows with live busy + occupant + equipment count
 *   - utilization() — per-station attended/setup/run/rework hours + machine cost over a window
 *   - detail()      — one station's header, mounted equipment, live occupancy and WO queue
 *
 * Every aggregate is a single org-scoped query (no N+1), reusing the same paid-seconds
 * and rate-coalesce idioms as time-tracking/costing so the numbers agree. Cost-bearing
 * fields are stripped for callers without `costing.view` (kept off the floor).
 */
@Injectable()
export class StationsService extends TenantScopedService<Station> {
  constructor(
    @InjectRepository(Station) repo: Repository<Station>,
    @InjectRepository(Line) private readonly lineRepo: Repository<Line>,
    private readonly events: EventsGateway,
  ) {
    super(repo);
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  /** Back-compat: stations of one line (the legacy per-line list endpoint). */
  async findByLine(lineId: string): Promise<Station[]> {
    return this.repo.find({ where: { lineId, organizationId: this.organizationId }, order: { name: 'ASC' } });
  }

  async create(dto: CreateStationDto): Promise<Station> {
    await this.assertLine(dto.lineId);
    await this.assertCodeUnique(dto.code ?? null, null);
    const data: DeepPartial<Station> = { ...dto, code: dto.code?.trim() || null };
    const saved = await this.saveCatching(await super.create(data));
    this.emit(saved, 'created');
    return this.reload(saved.id);
  }

  async update(id: string, dto: UpdateStationDto): Promise<Station> {
    const station = await this.findOne(id);
    if (dto.lineId && dto.lineId !== station.lineId) await this.assertLine(dto.lineId);
    if (dto.code !== undefined) await this.assertCodeUnique(dto.code || null, id);
    Object.assign(station, dto);
    if (dto.code !== undefined) station.code = dto.code?.trim() || null;
    const saved = await this.saveCatching(station);
    this.emit(saved, 'updated');
    return this.reload(saved.id);
  }

  /** Set the operational status (the `stations.operate` action). */
  async setStatus(id: string, status: StationStatus): Promise<Station> {
    const station = await this.findOne(id);
    station.status = status;
    const saved = await this.repo.save(station);
    this.emit(saved, 'status');
    return this.reload(saved.id);
  }

  /**
   * Safe delete. A station referenced by time entries, work-order stages or
   * equipment carries costing/production history, so hard-deleting it would
   * orphan that history — we refuse with a 409 and tell the user to deactivate
   * (isActive=false) instead. Only genuinely unused stations are removed.
   */
  async deleteStation(id: string): Promise<{ id: string; deleted: true }> {
    const station = await this.findOne(id);
    const org = this.organizationId;
    const [refs] = await this.repo.query(
      `SELECT
         (SELECT COUNT(*) FROM time_entries WHERE station_id = $1 AND organization_id = $2)::int AS time_entries,
         (SELECT COUNT(*) FROM work_order_stages WHERE station_id = $1 AND organization_id = $2)::int AS work_order_stages,
         (SELECT COUNT(*) FROM equipment WHERE station_id = $1 AND organization_id = $2)::int AS equipment`,
      [id, org],
    );
    const te = Number(refs?.time_entries ?? 0);
    const wos = Number(refs?.work_order_stages ?? 0);
    const eq = Number(refs?.equipment ?? 0);
    if (te + wos + eq > 0) {
      const parts: string[] = [];
      if (te) parts.push(`${te} time entr${te === 1 ? 'y' : 'ies'}`);
      if (wos) parts.push(`${wos} work-order stage${wos === 1 ? '' : 's'}`);
      if (eq) parts.push(`${eq} equipment asset${eq === 1 ? '' : 's'}`);
      throw new ConflictException(
        `Cannot delete "${station.name}" — it is referenced by ${parts.join(', ')}. Deactivate it instead to keep its history.`,
      );
    }
    await this.repo.remove(station);
    this.events.emitStationUpdate({ id, organizationId: org, action: 'deleted' }, org);
    return { id, deleted: true };
  }

  // ── Reads / aggregates ──────────────────────────────────────────────────────

  /** Org-wide directory: every station with line, type/status, live busy + occupant, equipment count. */
  async list(
    filters: { q?: string; lineId?: string; type?: string; status?: string; active?: boolean },
    withCost: boolean,
  ): Promise<any[]> {
    const org = this.organizationId;
    const where: string[] = ['sta.organization_id = $1'];
    const params: any[] = [org];
    let i = 2;
    if (filters.lineId) { where.push(`sta.line_id = $${i}`); params.push(filters.lineId); i++; }
    if (filters.type) { where.push(`sta.type = $${i}`); params.push(filters.type); i++; }
    if (filters.status) { where.push(`sta.status = $${i}`); params.push(filters.status); i++; }
    if (filters.active === true) where.push('sta.is_active = true');
    else if (filters.active === false) where.push('sta.is_active = false');
    if (filters.q) { where.push(`(sta.name ILIKE $${i} OR sta.code ILIKE $${i})`); params.push(`%${filters.q}%`); i++; }

    const rows = await this.repo.query(
      `SELECT sta.id, sta.name, sta.code, sta.type, sta.status, sta.is_active,
              sta.machine_rate, sta.available_hours_per_day, sta.line_id, ln.name AS line_name,
              EXISTS(SELECT 1 FROM time_entries te WHERE te.station_id = sta.id AND te.end_time IS NULL AND te.organization_id = $1) AS busy,
              (SELECT COUNT(*) FROM equipment e WHERE e.station_id = sta.id AND e.organization_id = $1)::int AS equipment_count,
              (SELECT TRIM(u.first_name || ' ' || COALESCE(u.last_name, ''))
                 FROM time_entries te JOIN users u ON u.id = te.user_id
                WHERE te.station_id = sta.id AND te.end_time IS NULL AND te.organization_id = $1
                ORDER BY te.start_time ASC LIMIT 1) AS occupant
         FROM stations sta
         LEFT JOIN lines ln ON ln.id = sta.line_id
        WHERE ${where.join(' AND ')}
        ORDER BY ln.name NULLS LAST, sta.name`,
      params,
    );
    return (rows as any[]).map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code ?? null,
      type: r.type,
      status: r.status,
      isActive: !!r.is_active,
      lineId: r.line_id,
      lineName: r.line_name ?? null,
      machineRate: withCost ? (r.machine_rate == null ? null : Number(r.machine_rate)) : null,
      hasMachineRate: Number(r.machine_rate) > 0,
      availableHoursPerDay: r.available_hours_per_day == null ? null : Number(r.available_hours_per_day),
      busy: !!r.busy,
      occupant: r.occupant ? String(r.occupant).trim() || null : null,
      equipmentCount: Number(r.equipment_count ?? 0),
    }));
  }

  /** Per-station utilization/cost aggregates over [from,to] (defaults to the last 7 days). */
  async utilization(fromStr: string | undefined, toStr: string | undefined, withCost: boolean, stationId?: string) {
    const org = this.organizationId;
    const { from, to } = this.parseWindow(fromStr, toStr);
    const windowDays = windowDaysInclusive(from, to);

    const paid = `GREATEST(COALESCE(te.duration_seconds,0) - COALESCE(te.break_seconds,0), 0)`;
    const mrate = `COALESCE(NULLIF(te.machine_rate,0), NULLIF(sta.machine_rate,0), 0)`;
    const params: any[] = [org, from, to];
    let stationFilter = '';
    if (stationId) { stationFilter = `AND sta.id = $4`; params.push(stationId); }

    const rows = await this.repo.query(
      `SELECT sta.id, sta.name, sta.code, sta.available_hours_per_day,
              COALESCE(SUM(${paid}),0)::bigint AS attended_seconds,
              COALESCE(SUM(CASE WHEN te.is_setup AND NOT te.is_rework THEN ${paid} ELSE 0 END),0)::bigint AS setup_seconds,
              COALESCE(SUM(CASE WHEN te.is_rework THEN ${paid} ELSE 0 END),0)::bigint AS rework_seconds,
              COALESCE(SUM(te.idle_seconds),0)::bigint AS idle_seconds,
              COALESCE(SUM(CASE WHEN ${mrate} > 0 THEN ${paid} ELSE 0 END),0)::bigint AS machine_seconds,
              COALESCE(SUM(${paid}/3600.0 * ${mrate}),0) AS machine_cost,
              COUNT(te.id)::int AS entries,
              COUNT(DISTINCT te.user_id)::int AS operators
         FROM stations sta
         LEFT JOIN time_entries te ON te.station_id = sta.id AND te.organization_id = $1
              AND te.start_time >= $2 AND te.start_time <= $3
        WHERE sta.organization_id = $1 ${stationFilter}
        GROUP BY sta.id, sta.name, sta.code, sta.available_hours_per_day
        ORDER BY attended_seconds DESC, sta.name`,
      params,
    );

    const stations = (rows as any[]).map((r) => {
      const u = composeStationUtilization(
        {
          attendedSeconds: Number(r.attended_seconds),
          setupSeconds: Number(r.setup_seconds),
          reworkSeconds: Number(r.rework_seconds),
          idleSeconds: Number(r.idle_seconds),
          machineSeconds: Number(r.machine_seconds),
          machineCost: Number(r.machine_cost),
          entries: Number(r.entries),
          operators: Number(r.operators),
        },
        { availableHoursPerDay: r.available_hours_per_day == null ? null : Number(r.available_hours_per_day), windowDays },
      );
      const shaped = withCost ? u : withoutCost(u);
      return { stationId: r.id, name: r.name, code: r.code ?? null, ...shaped };
    });

    const totals = {
      attendedSeconds: stations.reduce((s, x) => s + x.attendedSeconds, 0),
      attendedHours: round2(stations.reduce((s, x) => s + x.attendedHours, 0)),
      setupHours: round2(stations.reduce((s, x) => s + x.setupHours, 0)),
      runHours: round2(stations.reduce((s, x) => s + x.runHours, 0)),
      reworkHours: round2(stations.reduce((s, x) => s + x.reworkHours, 0)),
      machineCost: withCost ? round2(stations.reduce((s, x) => s + x.machineCost, 0)) : 0,
      entries: stations.reduce((s, x) => s + x.entries, 0),
    };

    return { from: from.toISOString(), to: to.toISOString(), windowDays, withCost, totals, stations };
  }

  /** One station's cockpit data: header + mounted equipment + live occupancy + WO queue. */
  async detail(id: string, withCost: boolean) {
    const station = await this.findOneWithLine(id);
    const org = this.organizationId;
    const [equipment, sessions, queue] = await Promise.all([
      this.repo.query(
        `SELECT e.id, e.code, e.name, e.type, e.status, e.is_active, e.hourly_rate
           FROM equipment e WHERE e.station_id = $1 AND e.organization_id = $2 ORDER BY e.name`,
        [id, org],
      ),
      this.openSessions(id),
      this.workOrderQueue(id),
    ]);
    return {
      station: this.shapeStation(station, withCost),
      equipment: (equipment as any[]).map((e) => ({
        id: e.id,
        code: e.code,
        name: e.name,
        type: e.type,
        status: e.status,
        isActive: !!e.is_active,
        hourlyRate: withCost ? (e.hourly_rate == null ? null : Number(e.hourly_rate)) : null,
      })),
      occupancy: { busy: sessions.length > 0, sessions },
      queue,
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private async openSessions(stationId: string) {
    const org = this.organizationId;
    const rows = await this.repo.query(
      `SELECT te.id, te.user_id, te.start_time, te.is_setup, te.is_rework,
              u.first_name, u.last_name, st.name AS stage_name,
              wo.id AS wo_id, wo.order_number, wo.production_order_id, n.mark, n.name AS node_name
         FROM time_entries te
         LEFT JOIN users u ON u.id = te.user_id
         LEFT JOIN work_order_stages s ON s.id = te.work_order_stage_id
         LEFT JOIN stages st ON st.id = s.stage_id
         LEFT JOIN work_orders wo ON wo.id = s.work_order_id
         LEFT JOIN assembly_nodes n ON n.id = wo.assembly_node_id
        WHERE te.station_id = $1 AND te.end_time IS NULL AND te.organization_id = $2
        ORDER BY te.start_time ASC`,
      [stationId, org],
    );
    const now = Date.now();
    return (rows as any[]).map((r) => ({
      id: r.id,
      userId: r.user_id,
      userName: [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Unknown',
      stageName: r.stage_name ?? null,
      workOrderId: r.wo_id ?? null,
      orderNumber: r.order_number ?? null,
      productionOrderId: r.production_order_id ?? null,
      mark: r.mark || r.node_name || null,
      isSetup: !!r.is_setup,
      isRework: !!r.is_rework,
      startTime: r.start_time,
      elapsedSeconds: r.start_time ? Math.round((now - new Date(r.start_time).getTime()) / 1000) : 0,
    }));
  }

  private async workOrderQueue(stationId: string) {
    const org = this.organizationId;
    const rows = await this.repo.query(
      `SELECT s.id AS wos_id, s.status, s.qty_done, s.qty_total,
              st.name AS stage_name, st.sequence,
              wo.id AS wo_id, wo.order_number, wo.status AS wo_status, wo.production_order_id,
              n.mark, n.name AS node_name
         FROM work_order_stages s
         JOIN work_orders wo ON wo.id = s.work_order_id
         LEFT JOIN stages st ON st.id = s.stage_id
         LEFT JOIN assembly_nodes n ON n.id = wo.assembly_node_id
        WHERE s.station_id = $1 AND s.organization_id = $2
          AND s.status IN ('pending','in_progress')
        ORDER BY (s.status = 'in_progress') DESC, st.sequence NULLS LAST, wo.order_number
        LIMIT 200`,
      [stationId, org],
    );
    const items = (rows as any[]).map((r) => ({
      workOrderStageId: r.wos_id,
      status: String(r.status),
      qtyDone: Number(r.qty_done ?? 0),
      qtyTotal: r.qty_total == null ? null : Number(r.qty_total),
      stageName: r.stage_name ?? null,
      sequence: Number(r.sequence ?? 0),
      workOrderId: r.wo_id,
      orderNumber: r.order_number,
      workOrderStatus: String(r.wo_status),
      productionOrderId: r.production_order_id ?? null,
      mark: r.mark || r.node_name || null,
    }));
    return {
      counts: {
        pending: items.filter((x) => x.status === 'pending').length,
        inProgress: items.filter((x) => x.status === 'in_progress').length,
      },
      items,
    };
  }

  private shapeStation(s: Station, withCost: boolean) {
    return {
      id: s.id,
      name: s.name,
      code: s.code ?? null,
      description: s.description ?? null,
      type: s.type,
      status: s.status,
      isActive: s.isActive,
      lineId: s.lineId,
      lineName: s.line?.name ?? null,
      machineRate: withCost ? (s.machineRate ?? null) : null,
      hasMachineRate: Number(s.machineRate) > 0,
      availableHoursPerDay: s.availableHoursPerDay ?? null,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }

  private async findOneWithLine(id: string): Promise<Station> {
    const s = await this.repo.findOne({ where: { id, organizationId: this.organizationId }, relations: ['line'] });
    if (!s) throw new NotFoundException('Station not found');
    return s;
  }

  private async reload(id: string): Promise<Station> {
    return this.findOneWithLine(id);
  }

  private async assertLine(lineId: string): Promise<Line> {
    const line = await this.lineRepo.findOne({ where: { id: lineId, organizationId: this.organizationId } });
    if (!line) throw new NotFoundException('Line not found in this organization');
    return line;
  }

  private async assertCodeUnique(code: string | null, excludeId: string | null): Promise<void> {
    const c = code?.trim();
    if (!c) return;
    const existing = await this.repo.findOne({ where: { code: c, organizationId: this.organizationId } });
    if (existing && existing.id !== excludeId) throw new ConflictException(`A station with code "${c}" already exists`);
  }

  /** Save, translating a Postgres unique violation into a clean 409. */
  private async saveCatching(entity: Station): Promise<Station> {
    try {
      return await this.repo.save(entity);
    } catch (err: any) {
      if (err?.code === '23505' || err?.driverError?.code === '23505') {
        throw new ConflictException('A station with that name already exists on this line');
      }
      throw err;
    }
  }

  private emit(station: Station, action: string): void {
    const org = this.organizationId;
    this.events.emitStationUpdate(
      { id: station.id, organizationId: org, action, status: station.status, lineId: station.lineId },
      org,
    );
  }

  private parseWindow(fromStr?: string, toStr?: string): { from: Date; to: Date } {
    const to = toStr ? new Date(toStr) : new Date();
    if (isNaN(to.getTime())) throw new BadRequestException(`Invalid 'to' date: '${toStr}'`);
    const from = fromStr ? new Date(fromStr) : new Date(to.getTime() - 6 * 86_400_000);
    if (isNaN(from.getTime())) throw new BadRequestException(`Invalid 'from' date: '${fromStr}'`);
    if (from.getTime() > to.getTime()) throw new BadRequestException(`'from' must not be after 'to'`);
    // Inclusive window: snap to UTC day boundaries so date-only inputs cover whole days.
    from.setUTCHours(0, 0, 0, 0);
    to.setUTCHours(23, 59, 59, 999);
    return { from, to };
  }
}

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}
