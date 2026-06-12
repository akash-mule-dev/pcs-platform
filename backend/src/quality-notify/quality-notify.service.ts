import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { NotificationPriority, NotificationType } from '../notifications/notification.entity.js';
import { EventsGateway } from '../websocket/events.gateway.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { severityToPriority } from '../quality-ncr/ncr-workflow.js';

/**
 * Cross-cutting quality eventing: in-app notifications + websocket broadcasts
 * for inspection failures, sign-off decisions and NCR lifecycle changes.
 *
 * Everything here is best-effort — a notification hiccup must never fail the
 * quality write it accompanies, so all public methods swallow + log errors.
 */
@Injectable()
export class QualityNotifyService {
  private readonly logger = new Logger(QualityNotifyService.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly notifications: NotificationsService,
    private readonly events: EventsGateway,
  ) {}

  /** Active QA-responsible users (managers + supervisors) of the current org. */
  private async qaAudience(excludeUserId?: string | null): Promise<string[]> {
    const org = TenantContext.getOrganizationId();
    const qb = this.userRepo
      .createQueryBuilder('u')
      .leftJoin('u.role', 'r')
      .where('r.name IN (:...roles)', { roles: ['admin', 'manager', 'supervisor'] })
      .andWhere('u.is_active = true');
    if (org) qb.andWhere('u.organization_id = :org', { org });
    const users = await qb.getMany();
    return users.map((u) => u.id).filter((id) => id !== excludeUserId);
  }

  /** A failed inspection was recorded (auto-fail or inspector judgement). */
  async inspectionFailed(input: {
    qualityDataId: string;
    label: string;            // shop-floor label: mark / mesh / region
    severity?: string | null;
    autoFailed?: boolean;
    inspectorUserId?: string | null;
  }): Promise<void> {
    try {
      const priority = severityToPriority(input.severity) as NotificationPriority;
      this.events.emitQualityAlert({
        kind: 'inspection-failed',
        qualityDataId: input.qualityDataId,
        label: input.label,
        severity: input.severity ?? null,
        autoFailed: !!input.autoFailed,
      });
      // Only interrupt people for the serious ones; the board shows the rest.
      if (priority === NotificationPriority.HIGH || priority === NotificationPriority.CRITICAL) {
        const audience = await this.qaAudience(input.inspectorUserId);
        if (audience.length) {
          await this.notifications.createForUsers(audience, {
            title: `Failed inspection: ${input.label}`,
            message: `${input.label} failed quality inspection${input.autoFailed ? ' (out-of-tolerance measurement)' : ''}${input.severity ? ` — severity ${input.severity}` : ''}.`,
            type: NotificationType.QUALITY_FAIL,
            priority,
            entityType: 'quality_data',
            entityId: input.qualityDataId,
          });
        }
      }
    } catch (e) {
      this.logger.warn(`inspectionFailed notification skipped: ${(e as Error).message}`);
    }
  }

  /** A sign-off decision was made on an inspection entry. */
  async signoffDecided(input: {
    qualityDataId: string;
    label: string;
    decision: 'approved' | 'rejected';
    deciderName: string | null;
    inspectorUserId?: string | null;
  }): Promise<void> {
    try {
      this.events.emitQualityAlert({
        kind: 'signoff',
        qualityDataId: input.qualityDataId,
        label: input.label,
        decision: input.decision,
      });
      if (input.inspectorUserId) {
        await this.notifications.create({
          userId: input.inspectorUserId,
          title: `Inspection ${input.decision}: ${input.label}`,
          message: `${input.deciderName ?? 'A reviewer'} ${input.decision} the failed inspection on ${input.label}.`,
          type: NotificationType.QUALITY_SIGNOFF,
          priority: NotificationPriority.MEDIUM,
          entityType: 'quality_data',
          entityId: input.qualityDataId,
        });
      }
    } catch (e) {
      this.logger.warn(`signoffDecided notification skipped: ${(e as Error).message}`);
    }
  }

  /** NCR lifecycle broadcast + targeted notifications. */
  async ncrEvent(input: {
    ncrId: string;
    number: string;
    title: string;
    severity?: string | null;
    kind: 'raised' | 'status' | 'assigned';
    status?: string;
    actorUserId?: string | null;
    assignedTo?: string | null;
  }): Promise<void> {
    try {
      this.events.emitQualityAlert({
        kind: `ncr-${input.kind}`,
        ncrId: input.ncrId,
        number: input.number,
        severity: input.severity ?? null,
        status: input.status ?? null,
      });
      if (input.kind === 'raised') {
        const audience = await this.qaAudience(input.actorUserId);
        if (audience.length) {
          await this.notifications.createForUsers(audience, {
            title: `NCR raised: ${input.number}`,
            message: `${input.title}${input.severity ? ` — severity ${input.severity}` : ''}`,
            type: NotificationType.QUALITY_FAIL,
            priority: severityToPriority(input.severity) as NotificationPriority,
            entityType: 'ncr',
            entityId: input.ncrId,
          });
        }
      } else if (input.kind === 'assigned' && input.assignedTo && input.assignedTo !== input.actorUserId) {
        await this.notifications.create({
          userId: input.assignedTo,
          title: `NCR assigned to you: ${input.number}`,
          message: input.title,
          type: NotificationType.QUALITY_FAIL,
          priority: severityToPriority(input.severity) as NotificationPriority,
          entityType: 'ncr',
          entityId: input.ncrId,
        });
      }
    } catch (e) {
      this.logger.warn(`ncrEvent notification skipped: ${(e as Error).message}`);
    }
  }
}
