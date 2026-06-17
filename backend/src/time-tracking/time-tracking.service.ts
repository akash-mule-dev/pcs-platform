import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { TimeEntry } from './time-entry.entity.js';
import { WorkOrderStage, WorkOrderStageStatus } from '../work-orders/work-order-stage.entity.js';
import { ClockInDto } from './dto/clock-in.dto.js';
import { ClockOutDto } from './dto/clock-out.dto.js';
import { UpdateTimeEntryDto } from './dto/update-time-entry.dto.js';
import { PageOptionsDto, PageDto, PageMetaDto } from '../common/dto/pagination.dto.js';
import { EventsGateway } from '../websocket/events.gateway.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { resolveRate } from '../costing/costing-math.js';

@Injectable()
export class TimeTrackingService {
  constructor(
    @InjectRepository(TimeEntry) private readonly teRepo: Repository<TimeEntry>,
    @InjectRepository(WorkOrderStage) private readonly wosRepo: Repository<WorkOrderStage>,
    private readonly eventsGateway: EventsGateway,
  ) {}

  private readonly logger = new Logger(TimeTrackingService.name);

  async clockIn(userId: string, dto: ClockInDto): Promise<TimeEntry> {
    // Check no active entry
    const active = await this.teRepo.findOne({ where: { userId, endTime: IsNull() } });
    if (active) throw new BadRequestException('User already has an active time entry');

    const wos = await this.wosRepo.findOne({ where: { id: dto.workOrderStageId } });
    if (!wos) throw new NotFoundException('Work order stage not found');

    // Update work order stage status
    wos.status = WorkOrderStageStatus.IN_PROGRESS;
    wos.startedAt = wos.startedAt || new Date();
    await this.wosRepo.save(wos);

    const entry = this.teRepo.create({
      userId,
      workOrderStageId: dto.workOrderStageId,
      stationId: dto.stationId || null,
      inputMethod: dto.inputMethod,
      isSetup: dto.isSetup ?? false,
      startTime: new Date(),
    });
    const saved = await this.teRepo.save(entry);
    const result = await this.teRepo.findOne({ where: { id: saved.id }, relations: ['user', 'workOrderStage', 'workOrderStage.stage', 'station'] });

    this.eventsGateway.emitTimeEntryUpdate(result!);
    this.eventsGateway.emitStageUpdate(wos);
    this.eventsGateway.emitDashboardRefresh();

    return result!;
  }

  async clockOut(userId: string, dto: ClockOutDto): Promise<TimeEntry> {
    const entry = await this.teRepo.findOne({
      where: { id: dto.timeEntryId },
      relations: ['user', 'workOrderStage', 'workOrderStage.stage', 'station'],
    });
    if (!entry) throw new NotFoundException('Time entry not found');
    if (entry.endTime) throw new BadRequestException('Time entry already clocked out');

    entry.endTime = new Date();
    entry.durationSeconds = Math.round((entry.endTime.getTime() - entry.startTime.getTime()) / 1000);
    if (dto.notes) entry.notes = dto.notes;

    // Freeze the labor rate at the moment work finished (the worker's personal
    // rate, else the stage standard rate). The org default is intentionally NOT
    // frozen — it's a live fallback applied at read time when this stays null —
    // so configuring/raising the default later still flows to un-rated entries.
    const frozen = resolveRate(entry.user?.hourlyRate, entry.workOrderStage?.stage?.hourlyRate, 0);
    entry.laborRate = frozen > 0 ? frozen : null;
    // Freeze this station's machine/work-center rate too (machine analog of labor_rate).
    const machine = Number(entry.station?.machineRate) || 0;
    entry.machineRate = machine > 0 ? machine : null;

    await this.teRepo.save(entry);

    // Update work order stage
    const wos = await this.wosRepo.findOne({ where: { id: entry.workOrderStageId } });
    if (wos) {
      wos.actualTimeSeconds = (wos.actualTimeSeconds || 0) + entry.durationSeconds;
      wos.status = WorkOrderStageStatus.COMPLETED;
      wos.completedAt = new Date();
      await this.wosRepo.save(wos);
      this.eventsGateway.emitStageUpdate(wos);
    }

    const result = await this.teRepo.findOne({ where: { id: entry.id }, relations: ['user', 'workOrderStage', 'workOrderStage.stage', 'station'] });
    this.eventsGateway.emitTimeEntryUpdate(result!);
    this.eventsGateway.emitDashboardRefresh();

    return result!;
  }

  async getActive(): Promise<any[]> {
    // Targeted projection (same approach as getHistory's QueryBuilder and the
    // dashboard live-status query). `find` with these relations auto-expands the
    // work-order's eager graph (process/line) and SELECTs every column,
    // which throws if any of those columns is absent from the DB — so the old
    // version silently returned [] even when operators were clocked in. Selecting
    // only the columns the live view renders avoids that entirely. The try/catch
    // remains as a final safety net.
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
        .addSelect('user.first_name', 'firstName')
        .addSelect('user.last_name', 'lastName')
        .addSelect('station.name', 'stationName')
        .addSelect('stage.name', 'stageName')
        .addSelect('wo.order_number', 'orderNumber')
        .where('te.end_time IS NULL')
        .orderBy('te.start_time', 'ASC');
      const org = TenantContext.getOrganizationId();
      if (org) qb.andWhere('te.organization_id = :org', { org });
      const rows = await qb.getRawMany();

      return rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        startTime: r.startTime,
        elapsedSeconds: r.startTime
          ? Math.round((Date.now() - new Date(r.startTime).getTime()) / 1000)
          : 0,
        user: { firstName: r.firstName, lastName: r.lastName },
        station: r.stationName ? { name: r.stationName } : null,
        workOrderStage: {
          stage: r.stageName ? { name: r.stageName } : null,
          workOrder: r.orderNumber ? { orderNumber: r.orderNumber } : null,
        },
      }));
    } catch (err) {
      // Degrade gracefully: the live view shows no active entries rather than
      // failing the whole request if a related row is malformed.
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

  async update(id: string, dto: UpdateTimeEntryDto): Promise<TimeEntry> {
    const entry = await this.teRepo.findOne({ where: { id } });
    if (!entry) throw new NotFoundException('Time entry not found');
    if (dto.startTime) entry.startTime = new Date(dto.startTime);
    if (dto.endTime) {
      entry.endTime = new Date(dto.endTime);
      entry.durationSeconds = Math.round((entry.endTime.getTime() - entry.startTime.getTime()) / 1000);
    }
    if (dto.breakSeconds !== undefined) entry.breakSeconds = dto.breakSeconds;
    if (dto.idleSeconds !== undefined) entry.idleSeconds = dto.idleSeconds;
    if (dto.notes !== undefined) entry.notes = dto.notes;
    await this.teRepo.save(entry);
    return this.teRepo.findOne({ where: { id }, relations: ['user', 'workOrderStage', 'workOrderStage.stage', 'station'] }) as Promise<TimeEntry>;
  }
}
