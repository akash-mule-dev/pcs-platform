import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, MoreThanOrEqual } from 'typeorm';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { WorkOrderStage, WorkOrderStageStatus } from '../work-orders/work-order-stage.entity.js';
import { TimeEntry } from '../time-tracking/time-entry.entity.js';
import { QualityData } from '../quality-data/quality-data.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(WorkOrder) private readonly woRepo: Repository<WorkOrder>,
    @InjectRepository(WorkOrderStage) private readonly wosRepo: Repository<WorkOrderStage>,
    @InjectRepository(TimeEntry) private readonly teRepo: Repository<TimeEntry>,
    @InjectRepository(QualityData) private readonly qdRepo: Repository<QualityData>,
  ) {}

  private readonly logger = new Logger(DashboardService.name);

  private parseDate(value: string | undefined, fieldName: string): Date | undefined {
    if (!value) return undefined;
    const d = new Date(value);
    if (isNaN(d.getTime())) {
      throw new BadRequestException(`Invalid ${fieldName}: '${value}'`);
    }
    return d;
  }

  async getSummary() {
    // Each KPI is computed independently and defensively: a single failing
    // query degrades that metric to a safe default instead of returning a 500
    // for the entire dashboard.
    const org = TenantContext.getOrganizationId();
    let workOrdersByStatus: Array<{ status: string; count: string }> = [];
    try {
      const woQb = this.woRepo.createQueryBuilder('wo')
        .select('wo.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .groupBy('wo.status');
      if (org) woQb.where('wo.organization_id = :org', { org });
      workOrdersByStatus = await woQb.getRawMany();
    } catch (err) {
      this.logger.error(`getSummary.workOrdersByStatus failed: ${(err as Error).message}`);
    }

    let activeOperators = 0;
    try {
      activeOperators = await this.teRepo.count({ where: { endTime: IsNull(), organizationId: org ?? undefined } });
    } catch (err) {
      this.logger.error(`getSummary.activeOperators failed: ${(err as Error).message}`);
    }

    let todayCompletedStages = 0;
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      todayCompletedStages = await this.wosRepo.count({
        where: { status: WorkOrderStageStatus.COMPLETED, completedAt: MoreThanOrEqual(today), organizationId: org ?? undefined },
      });
    } catch (err) {
      this.logger.error(`getSummary.todayCompletedStages failed: ${(err as Error).message}`);
    }

    let avgEfficiency: number | null = null;
    try {
      const effQb = this.teRepo.createQueryBuilder('te')
        .leftJoin('te.workOrderStage', 'wos')
        .leftJoin('wos.stage', 'stage')
        .select('AVG(CASE WHEN te.duration_seconds > 0 AND stage.target_time_seconds > 0 THEN LEAST((stage.target_time_seconds::float / te.duration_seconds) * 100, 100) ELSE NULL END)', 'avgEfficiency')
        .where('te.end_time IS NOT NULL');
      if (org) effQb.andWhere('te.organization_id = :org', { org });
      const effResult = await effQb.getRawOne();
      avgEfficiency = effResult?.avgEfficiency ? parseFloat(parseFloat(effResult.avgEfficiency).toFixed(1)) : null;
    } catch (err) {
      this.logger.error(`getSummary.avgEfficiency failed: ${(err as Error).message}`);
    }

    return {
      workOrdersByStatus,
      activeOperators,
      todayCompletedStages,
      avgEfficiency,
    };
  }

  /**
   * Per-user "my day" stats (mobile home screen). Computed server-side so the
   * numbers share definitions — and the midnight boundary — with getSummary,
   * instead of each client re-deriving them from raw history.
   * An entry counts toward "today" when it FINISHED today.
   */
  async getMyDay(userId: string) {
    const empty = { trackedSeconds: 0, entriesCompleted: 0, workOrdersWorked: 0 };
    if (!userId) return empty;
    const org = TenantContext.getOrganizationId();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    try {
      const qb = this.teRepo.createQueryBuilder('te')
        .leftJoin('te.workOrderStage', 'wos')
        .select('COALESCE(SUM(te.duration_seconds), 0)', 'trackedSeconds')
        .addSelect('COUNT(te.id)', 'entriesCompleted')
        .addSelect('COUNT(DISTINCT wos.work_order_id)', 'workOrdersWorked')
        .where('te.user_id = :userId', { userId })
        .andWhere('te.end_time IS NOT NULL')
        .andWhere('te.end_time >= :today', { today });
      if (org) qb.andWhere('te.organization_id = :org', { org });
      const row = await qb.getRawOne();
      return {
        trackedSeconds: parseInt(row?.trackedSeconds, 10) || 0,
        entriesCompleted: parseInt(row?.entriesCompleted, 10) || 0,
        workOrdersWorked: parseInt(row?.workOrdersWorked, 10) || 0,
      };
    } catch (err) {
      this.logger.error(`getMyDay failed: ${(err as Error).message}`);
      return empty;
    }
  }

  async getLiveStatus() {
    // Select only the columns the dashboard "Live Stage Status" table reads.
    // Using an explicit QueryBuilder (instead of `find` with eager relations)
    // avoids two failure modes: (1) SELECTing every column of the eager entity
    // graph — which 500s if any entity declares a column missing from the DB —
    // and (2) serializing spread entities that can carry circular references.
    // Defensive try/catch mirrors getSummary: a query failure degrades to an
    // empty list rather than a 500 for the whole widget.
    try {
      const qb = this.teRepo.createQueryBuilder('te')
        .leftJoin('te.user', 'user')
        .leftJoin('te.station', 'station')
        .leftJoin('te.workOrderStage', 'wos')
        .leftJoin('wos.stage', 'stage')
        .leftJoin('wos.workOrder', 'wo')
        .select('te.id', 'id')
        .addSelect('te.start_time', 'startTime')
        .addSelect('user.first_name', 'firstName')
        .addSelect('user.last_name', 'lastName')
        .addSelect('station.name', 'stationName')
        .addSelect('stage.name', 'stageName')
        .addSelect('wo.order_number', 'orderNumber')
        .where('te.end_time IS NULL');
      const org = TenantContext.getOrganizationId();
      if (org) qb.andWhere('te.organization_id = :org', { org });
      const rows = await qb.getRawMany();

      return rows.map((r) => ({
        id: r.id,
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
      this.logger.error(`getLiveStatus failed: ${(err as Error).message}`);
      return [];
    }
  }

  async getOperatorPerformance() {
    const results = await this.teRepo.createQueryBuilder('te')
      .leftJoin('te.user', 'user')
      .leftJoin('te.workOrderStage', 'wos')
      .leftJoin('wos.stage', 'stage')
      .select('user.id', 'userId')
      .addSelect("user.first_name || ' ' || user.last_name", 'operatorName')
      .addSelect('SUM(te.duration_seconds)', 'totalTime')
      .addSelect('COUNT(te.id)', 'stagesCompleted')
      .addSelect('AVG(CASE WHEN te.duration_seconds > 0 AND stage.target_time_seconds > 0 THEN LEAST((stage.target_time_seconds::float / te.duration_seconds) * 100, 100) ELSE NULL END)', 'avgEfficiency')
      .where('te.end_time IS NOT NULL')
      .groupBy('user.id')
      .addGroupBy('user.first_name')
      .addGroupBy('user.last_name')
      .getRawMany();

    return results.map((r) => ({
      userId: r.userId,
      operatorName: r.operatorName,
      totalTime: parseInt(r.totalTime) || 0,
      stagesCompleted: parseInt(r.stagesCompleted) || 0,
      avgEfficiency: r.avgEfficiency ? parseFloat(parseFloat(r.avgEfficiency).toFixed(1)) : null,
    }));
  }

  async getStageAnalytics() {
    const results = await this.teRepo.createQueryBuilder('te')
      .leftJoin('te.workOrderStage', 'wos')
      .leftJoin('wos.stage', 'stage')
      .select('stage.id', 'stageId')
      .addSelect('stage.name', 'stageName')
      .addSelect('stage.target_time_seconds', 'targetTime')
      .addSelect('AVG(te.duration_seconds)', 'avgTime')
      .addSelect('MIN(te.duration_seconds)', 'minTime')
      .addSelect('MAX(te.duration_seconds)', 'maxTime')
      .addSelect('COUNT(te.id)', 'entryCount')
      .where('te.end_time IS NOT NULL')
      .groupBy('stage.id')
      .addGroupBy('stage.name')
      .addGroupBy('stage.target_time_seconds')
      .getRawMany();

    return results.map((r) => ({
      stageId: r.stageId,
      stageName: r.stageName,
      targetTime: parseInt(r.targetTime) || 0,
      avgTime: r.avgTime ? parseFloat(parseFloat(r.avgTime).toFixed(0)) : 0,
      minTime: parseInt(r.minTime) || 0,
      maxTime: parseInt(r.maxTime) || 0,
      entryCount: parseInt(r.entryCount) || 0,
      efficiency: r.targetTime && r.avgTime ? Math.min(100, parseFloat(((r.targetTime / r.avgTime) * 100).toFixed(1))) : null,
    }));
  }

  /** Phase 8: OEE = Availability × Performance × Quality */
  async getOEE(startDate?: string, endDate?: string) {
    const start = this.parseDate(startDate, 'startDate');
    const end = this.parseDate(endDate, 'endDate');

    // Use QueryBuilder so date filters actually work
    const qb = this.teRepo.createQueryBuilder('te')
      .leftJoinAndSelect('te.workOrderStage', 'wos')
      .leftJoinAndSelect('wos.stage', 'stage')
      .where('te.end_time IS NOT NULL');

    if (start) qb.andWhere('te.start_time >= :startDate', { startDate: start });
    if (end) qb.andWhere('te.start_time <= :endDate', { endDate: end });

    const finished = await qb.getMany();

    let totalActualTime = 0;
    let totalPlannedTime = 0;
    for (const e of finished) {
      totalActualTime += e.durationSeconds || 0;
      totalPlannedTime += e.workOrderStage?.stage?.targetTimeSeconds || 0;
    }

    const availability = totalPlannedTime > 0
      ? Math.min(1, totalPlannedTime / Math.max(totalActualTime, 1))
      : 0;

    // Performance: target cycle time / actual cycle time
    const performance = totalActualTime > 0 && totalPlannedTime > 0
      ? Math.min(1, totalPlannedTime / totalActualTime)
      : 0;

    // Quality: pass rate from quality data
    const totalQD = await this.qdRepo.count();
    const passQD = await this.qdRepo.count({ where: { status: 'pass' } });
    const quality = totalQD > 0 ? passQD / totalQD : 1;

    const oee = availability * performance * quality;

    return {
      oee: parseFloat((oee * 100).toFixed(1)),
      availability: parseFloat((availability * 100).toFixed(1)),
      performance: parseFloat((performance * 100).toFixed(1)),
      quality: parseFloat((quality * 100).toFixed(1)),
      totalEntries: finished.length,
      totalActualTime,
      totalPlannedTime,
    };
  }

  /** Phase 8: Exportable report data (CSV-friendly) */
  async getExportData(startDate?: string, endDate?: string) {
    const start = this.parseDate(startDate, 'startDate');
    const end = this.parseDate(endDate, 'endDate');

    const qb = this.teRepo.createQueryBuilder('te')
      .leftJoinAndSelect('te.user', 'user')
      .leftJoinAndSelect('te.workOrderStage', 'wos')
      .leftJoinAndSelect('wos.stage', 'stage')
      .leftJoinAndSelect('wos.workOrder', 'wo')
      .leftJoinAndSelect('te.station', 'station')
      .where('te.end_time IS NOT NULL')
      .orderBy('te.start_time', 'DESC');

    if (start) qb.andWhere('te.start_time >= :startDate', { startDate: start });
    if (end) qb.andWhere('te.start_time <= :endDate', { endDate: end });

    const entries = await qb.getMany();

    return entries.map(e => ({
      operator: `${e.user?.firstName || ''} ${e.user?.lastName || ''}`.trim(),
      employeeId: e.user?.employeeId || '',
      workOrder: e.workOrderStage?.workOrder?.orderNumber || '',
      stage: e.workOrderStage?.stage?.name || '',
      station: e.station?.name || '',
      startTime: e.startTime,
      endTime: e.endTime,
      durationSeconds: e.durationSeconds,
      targetTimeSeconds: e.workOrderStage?.stage?.targetTimeSeconds || null,
      variance: e.durationSeconds && e.workOrderStage?.stage?.targetTimeSeconds
        ? e.durationSeconds - e.workOrderStage.stage.targetTimeSeconds
        : null,
      inputMethod: e.inputMethod,
      isRework: e.isRework,
    }));
  }
}
