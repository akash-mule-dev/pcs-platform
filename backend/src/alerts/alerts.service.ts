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
      relations: ['product'],
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
        message: `Work order ${wo.orderNumber} (${wo.product?.name || 'Unknown'}) is past due date.`,
        type: NotificationType.WORK_ORDER_OVERDUE,
        priority: NotificationPriority.HIGH,
        entityType: 'work_order',
        entityId: wo.id,
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

    this.eventsGateway.emitDashboardRefresh({ type: 'shift_summary' });
    this.logger.log('Shift summary generated');
  }
}
