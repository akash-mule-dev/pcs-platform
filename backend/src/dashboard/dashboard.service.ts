import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { WorkOrderStage } from '../work-orders/work-order-stage.entity.js';
import { TimeEntry } from '../time-tracking/time-entry.entity.js';
import { QualityData } from '../quality-data/quality-data.entity.js';

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(WorkOrder) private readonly woRepo: Repository<WorkOrder>,
    @InjectRepository(WorkOrderStage) private readonly wosRepo: Repository<WorkOrderStage>,
    @InjectRepository(TimeEntry) private readonly teRepo: Repository<TimeEntry>,
    @InjectRepository(QualityData) private readonly qdRepo: Repository<QualityData>,
  ) {}

  async getSummary() {
    const statusCounts = await this.woRepo.createQueryBuilder('wo')
      .select('wo.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('wo.status')
      .getRawMany();

    const activeOperators = await this.teRepo.count({ where: { endTime: IsNull() } });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayCompleted = await this.wosRepo.createQueryBuilder('wos')
      .where('wos.completed_at >= :today', { today })
      .andWhere('wos.status = :status', { status: 'completed' })
      .getCount();

    const effResult = await this.teRepo.createQueryBuilder('te')
      .leftJoin('te.workOrderStage', 'wos')
      .leftJoin('wos.stage', 'stage')
      .select('AVG(CASE WHEN te.duration_seconds > 0 AND stage.target_time_seconds > 0 THEN (stage.target_time_seconds::float / te.duration_seconds) * 100 ELSE NULL END)', 'avgEfficiency')
      .where('te.end_time IS NOT NULL')
      .getRawOne();

    return {
      workOrdersByStatus: statusCounts,
      activeOperators,
      todayCompletedStages: todayCompleted,
      avgEfficiency: effResult?.avgEfficiency ? parseFloat(parseFloat(effResult.avgEfficiency).toFixed(1)) : null,
    };
  }

  async getLiveStatus() {
    const entries = await this.teRepo.find({
      where: { endTime: IsNull() },
      relations: ['user', 'workOrderStage', 'workOrderStage.stage', 'workOrderStage.workOrder', 'station'],
    });
    return entries.map((e) => ({
      ...e,
      elapsedSeconds: Math.round((Date.now() - new Date(e.startTime).getTime()) / 1000),
    }));
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
      .addSelect('AVG(CASE WHEN te.duration_seconds > 0 AND stage.target_time_seconds > 0 THEN (stage.target_time_seconds::float / te.duration_seconds) * 100 ELSE NULL END)', 'avgEfficiency')
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
      efficiency: r.targetTime && r.avgTime ? parseFloat(((r.targetTime / r.avgTime) * 100).toFixed(1)) : null,
    }));
  }

  /** Phase 8: OEE = Availability × Performance × Quality */
  async getOEE(startDate?: string, endDate?: string) {
    // Use QueryBuilder so date filters actually work
    const qb = this.teRepo.createQueryBuilder('te')
      .leftJoinAndSelect('te.workOrderStage', 'wos')
      .leftJoinAndSelect('wos.stage', 'stage')
      .where('te.end_time IS NOT NULL');

    if (startDate) qb.andWhere('te.start_time >= :startDate', { startDate });
    if (endDate) qb.andWhere('te.start_time <= :endDate', { endDate });

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
    const qb = this.teRepo.createQueryBuilder('te')
      .leftJoinAndSelect('te.user', 'user')
      .leftJoinAndSelect('te.workOrderStage', 'wos')
      .leftJoinAndSelect('wos.stage', 'stage')
      .leftJoinAndSelect('wos.workOrder', 'wo')
      .leftJoinAndSelect('te.station', 'station')
      .where('te.end_time IS NOT NULL')
      .orderBy('te.start_time', 'DESC');

    if (startDate) qb.andWhere('te.start_time >= :startDate', { startDate });
    if (endDate) qb.andWhere('te.start_time <= :endDate', { endDate });

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
