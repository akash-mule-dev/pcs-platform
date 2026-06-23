import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { NotificationPriority, NotificationType } from '../notifications/notification.entity.js';
import { EventsGateway } from '../websocket/events.gateway.js';
import { TenantContext } from '../common/tenant/tenant-context.js';

/** Map a quality severity to a notification priority. */
function severityToPriority(severity: string | null | undefined): 'low' | 'medium' | 'high' | 'critical' {
  switch (severity) {
    case 'critical': return 'critical';
    case 'high': return 'high';
    case 'low': return 'low';
    default: return 'medium';
  }
}

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
      }, TenantContext.getOrganizationId());
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

  /**
   * An NCR was raised (created or spawned from a failed inspection). Notifies the
   * QA audience to disposition it, and broadcasts a `quality-alert` for live refresh.
   */
  async ncrRaised(input: {
    reportId: string;
    number: string;
    label: string;            // item mark / report number
    assemblyNodeId?: string | null;
    productionOrderId?: string | null;
    severity?: string | null;
    raisedByUserId?: string | null;
  }): Promise<void> {
    try {
      this.events.emitQualityAlert({
        kind: 'ncr-raised',
        reportId: input.reportId,
        number: input.number,
        ncrStatus: 'open',
        assemblyNodeId: input.assemblyNodeId ?? null,
        productionOrderId: input.productionOrderId ?? null,
      }, TenantContext.getOrganizationId());
      const audience = await this.qaAudience(input.raisedByUserId);
      if (audience.length) {
        await this.notifications.createForUsers(audience, {
          title: `NCR raised: ${input.number}`,
          message: `${input.label} — a non-conformance (${input.number}) was raised and needs disposition.`,
          type: NotificationType.QUALITY_FAIL,
          priority: severityToPriority(input.severity) as NotificationPriority,
          entityType: 'quality_report',
          entityId: input.reportId,
        });
      }
    } catch (e) {
      this.logger.warn(`ncrRaised notification skipped: ${(e as Error).message}`);
    }
  }

  /**
   * An NCR moved through its lifecycle (under_review / dispositioned / closed /
   * reopened / cancelled). Broadcast-only (`quality-alert`) so every connected
   * client viewing the assembly/order refreshes live — including the other device.
   */
  async ncrLifecycle(input: {
    reportId: string;
    number: string;
    kind: 'under_review' | 'dispositioned' | 'closed' | 'reopened' | 'cancelled';
    ncrStatus: string | null;
    assemblyNodeId?: string | null;
    productionOrderId?: string | null;
  }): Promise<void> {
    try {
      this.events.emitQualityAlert({
        kind: `ncr-${input.kind}`,
        reportId: input.reportId,
        number: input.number,
        ncrStatus: input.ncrStatus,
        assemblyNodeId: input.assemblyNodeId ?? null,
        productionOrderId: input.productionOrderId ?? null,
      }, TenantContext.getOrganizationId());
    } catch (e) {
      this.logger.warn(`ncrLifecycle notification skipped: ${(e as Error).message}`);
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
      }, TenantContext.getOrganizationId());
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
}
