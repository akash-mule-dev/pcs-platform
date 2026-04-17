import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { TimeEntry } from './time-entry.entity.js';
import { WorkOrderStage, WorkOrderStageStatus } from '../work-orders/work-order-stage.entity.js';
import { ClockInDto } from './dto/clock-in.dto.js';
import { ClockOutDto } from './dto/clock-out.dto.js';
import { UpdateTimeEntryDto } from './dto/update-time-entry.dto.js';
import { PageOptionsDto, PageDto, PageMetaDto } from '../common/dto/pagination.dto.js';
import { EventsGateway } from '../websocket/events.gateway.js';

@Injectable()
export class TimeTrackingService {
  constructor(
    @InjectRepository(TimeEntry) private readonly teRepo: Repository<TimeEntry>,
    @InjectRepository(WorkOrderStage) private readonly wosRepo: Repository<WorkOrderStage>,
    private readonly eventsGateway: EventsGateway,
  ) {}

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
    const entry = await this.teRepo.findOne({ where: { id: dto.timeEntryId }, relations: ['workOrderStage'] });
    if (!entry) throw new NotFoundException('Time entry not found');
    if (entry.endTime) throw new BadRequestException('Time entry already clocked out');

    entry.endTime = new Date();
    entry.durationSeconds = Math.round((entry.endTime.getTime() - entry.startTime.getTime()) / 1000);
    if (dto.notes) entry.notes = dto.notes;
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

  async getActive(): Promise<TimeEntry[]> {
    return this.teRepo.find({
      where: { endTime: IsNull() },
      relations: ['user', 'workOrderStage', 'workOrderStage.stage', 'workOrderStage.workOrder', 'station'],
    });
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

    const [items, count] = await qb.getManyAndCount();
    return new PageDto(items, new PageMetaDto(pageOptions, count));
  }

  async getByUser(userId: string): Promise<TimeEntry[]> {
    return this.teRepo.find({
      where: { userId },
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
