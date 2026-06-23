import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, LessThan, MoreThan } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { WorkOrder, WorkOrderStatus } from '../work-orders/work-order.entity.js';
import { TimeEntry } from '../time-tracking/time-entry.entity.js';
import { User } from '../auth/entities/user.entity.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { NotificationType, NotificationPriority } from '../notifications/notification.entity.js';
import { EventsGateway } from '../websocket/events.gateway.js';

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @InjectRepository(WorkOrder) private readonly woRepo: Repository<WorkOrder>,
    @InjectRepository(TimeEntry) private readonly teRepo: Repository<TimeEntry>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly notificationsService: NotificationsService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  /** Check for overdue work orders every 15 minutes */
  @Cron('0 */15 * * * *')
  async checkOverdueWorkOrders(): Promise<void> {
    const now = new Date();
    const overdueOrders = await this.woRepo.find({
      where: {
        dueDate: LessThan(now),
        status: WorkOrderStatus.IN_PROGRESS,
      },
    });

    if (overdueOrders.length === 0) return;
    this.logger.log(`Found ${overdueOrders.length} overdue work orders`);

    const managers = await this.userRepo
      .createQueryBuilder('u')
      .leftJoin('u.role', 'r')
      .where('r.name IN (:...roles)', { roles: ['admin', 'manager'] })
      .andWhere('u.is_active = true')
      .getMany();

    const managerIds = managers.map(m => m.id);

    for (const wo of overdueOrders) {
      await this.notificationsService.createForUsers(managerIds, {
        title: `Overdue: ${wo.orderNumber}`,
        message: `Work order ${wo.orderNumber} is past due date.`,
        type: NotificationType.WORK_ORDER_OVERDUE,
        priority: NotificationPriority.HIGH,
        entityType: 'work_order',
        entityId: wo.id,
      });
    }
  }

  /**
   * Escalate aging open NCRs once a day (08:00). Tiered: > 7 days notifies the
   * org's QA managers/supervisors; > 30 days also escalates to admins. Reuses the
   * `resolved_at IS NULL` + `created_at` predicate from the quality-insights aging
   * buckets. A daily cadence is the intended nag until the NCR is closed.
   */
  @Cron('0 0 8 * * *')
  async checkOverdueNcrs(): Promise<void> {
    const rows: { id: string; number: string; organization_id: string; age_days: number }[] = await this.woRepo.query(
      `SELECT id, number, organization_id, EXTRACT(DAY FROM now() - created_at)::int AS age_days
         FROM quality_reports
        WHERE template_type = 'ncr' AND resolved_at IS NULL
          AND created_at < now() - interval '7 days'`,
    );
    if (!rows.length) return;
    this.logger.log(`Found ${rows.length} aging open NCRs`);

    // Cache the audience per (org, tier) so we resolve users once.
    const audienceCache = new Map<string, string[]>();
    const audience = async (org: string, withAdmins: boolean): Promise<string[]> => {
      const key = `${org}|${withAdmins}`;
      const cached = audienceCache.get(key);
      if (cached) return cached;
      const roles = withAdmins ? ['admin', 'manager', 'supervisor'] : ['manager', 'supervisor'];
      const users = await this.userRepo
        .createQueryBuilder('u')
        .leftJoin('u.role', 'r')
        .where('r.name IN (:...roles)', { roles })
        .andWhere('u.is_active = true')
        .andWhere('u.organization_id = :org', { org })
        .getMany();
      const ids = users.map((u) => u.id);
      audienceCache.set(key, ids);
      return ids;
    };

    for (const ncr of rows) {
      const critical = ncr.age_days > 30;
      const ids = await audience(ncr.organization_id, critical);
      if (!ids.length) continue;
      await this.notificationsService.createForUsers(ids, {
        title: `NCR overdue: ${ncr.number}`,
        message: `${ncr.number} has been open for ${ncr.age_days} day${ncr.age_days === 1 ? '' : 's'}${critical ? ' — escalated' : ''}. Disposition and close it.`,
        type: NotificationType.NCR_OVERDUE,
        priority: critical ? NotificationPriority.CRITICAL : NotificationPriority.HIGH,
        entityType: 'quality_report',
        entityId: ncr.id,
      });
    }
  }

  /** Check for idle stations every 10 minutes */
  @Cron('0 */10 * * * *')
  async checkIdleStations(): Promise<void> {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    const activeEntries = await this.teRepo.find({ where: { endTime: IsNull() } });

    const idleEntries = activeEntries.filter(
      e => new Date(e.startTime).getTime() < thirtyMinAgo.getTime(),
    );

    if (idleEntries.length === 0) return;
    this.logger.log(`Found ${idleEntries.length} entries running > 30 min`);

    const supervisors = await this.userRepo
      .createQueryBuilder('u')
      .leftJoin('u.role', 'r')
      .where('r.name IN (:...roles)', { roles: ['admin', 'manager', 'supervisor'] })
      .andWhere('u.is_active = true')
      .getMany();

    const supervisorIds = supervisors.map(s => s.id);

    for (const entry of idleEntries) {
      const elapsed = Math.round((Date.now() - new Date(entry.startTime).getTime()) / 60000);
      await this.notificationsService.createForUsers(supervisorIds, {
        title: 'Long-running operation',
        message: `Operator has been clocked in for ${elapsed} minutes without completion.`,
        type: NotificationType.STATION_IDLE,
        priority: NotificationPriority.MEDIUM,
        entityType: 'time_entry',
        entityId: entry.id,
      });
    }
  }

  /** Generate shift summary at 6 PM every day */
  @Cron('0 0 18 * * *')
  async generateShiftSummary(): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const completedStages = await this.teRepo.count({
      where: { endTime: MoreThan(today) },
    });

    const completedOrders = await this.woRepo.count({
      where: { completedAt: MoreThan(today), status: WorkOrderStatus.COMPLETED },
    });

    const activeEntries = await this.teRepo.count({ where: { endTime: IsNull() } });

    const managers = await this.userRepo
      .createQueryBuilder('u')
      .leftJoin('u.role', 'r')
      .where('r.name IN (:...roles)', { roles: ['admin', 'manager', 'supervisor'] })
      .andWhere('u.is_active = true')
      .getMany();

    const managerIds = managers.map(m => m.id);

    await this.notificationsService.createForUsers(managerIds, {
      title: 'Daily Shift Summary',
      message: `Today: ${completedStages} stages completed, ${completedOrders} work orders finished, ${activeEntries} still active.`,
      type: NotificationType.SHIFT_SUMMARY,
      priority: NotificationPriority.LOW,
    });

    // System-wide daily summary (spans all tenants) — intentionally broadcast.
    this.eventsGateway.emitDashboardRefresh(null, { type: 'shift_summary' });
    this.logger.log('Shift summary generated');
  }
}
