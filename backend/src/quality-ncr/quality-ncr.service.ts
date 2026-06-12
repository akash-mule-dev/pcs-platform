import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ncr, NcrStatus } from './entities/ncr.entity.js';
import { Capa, CapaStatus } from './entities/capa.entity.js';
import { NcrEvent, NcrEventType } from './entities/ncr-event.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { CreateNcrDto, UpdateNcrDto, NcrFilterDto } from './dto/ncr.dto.js';
import { CreateCapaDto, UpdateCapaDto } from './dto/capa.dto.js';
import { capaTransitionError, ncrTransitionError } from './ncr-workflow.js';
import { User } from '../auth/entities/user.entity.js';
import { AuditService } from '../audit/audit.service.js';
import { QualityNotifyService } from '../quality-notify/quality-notify.service.js';

@Injectable()
export class QualityNcrService {
  constructor(
    @InjectRepository(Ncr) private readonly ncrRepo: Repository<Ncr>,
    @InjectRepository(Capa) private readonly capaRepo: Repository<Capa>,
    @InjectRepository(NcrEvent) private readonly eventRepo: Repository<NcrEvent>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly audit: AuditService,
    private readonly notify: QualityNotifyService,
  ) {}

  private get org(): string { return TenantContext.requireOrganizationId(); }
  private get userId(): string | null { return TenantContext.get()?.userId ?? null; }

  private async actor(): Promise<{ id: string | null; name: string | null }> {
    const id = this.userId;
    if (!id) return { id: null, name: null };
    const u = await this.userRepo.findOne({ where: { id } as any });
    const name = u ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email : null;
    return { id, name };
  }

  private async recordEvent(
    ncrId: string,
    type: NcrEventType,
    detail: { fromStatus?: string | null; toStatus?: string | null; note?: string | null },
    actor?: { id: string | null; name: string | null },
  ): Promise<NcrEvent> {
    const who = actor ?? (await this.actor());
    return this.eventRepo.save(this.eventRepo.create({
      ncrId,
      organizationId: this.org,
      type,
      fromStatus: detail.fromStatus ?? null,
      toStatus: detail.toStatus ?? null,
      note: detail.note ?? null,
      actorUserId: who.id,
      actorName: who.name,
    }));
  }

  /** Linked records must exist in THIS organization (or be omitted). */
  private async assertLinksValid(dto: Partial<CreateNcrDto>): Promise<void> {
    const org = this.org;
    const checks: Array<[string | undefined, string, string]> = [
      [dto.workOrderId, 'work_orders', 'Work order'],
      [dto.assemblyNodeId, 'assembly_nodes', 'Assembly item'],
      [dto.projectId, 'projects', 'Project'],
      [dto.qualityDataId, 'quality_data', 'Quality record'],
    ];
    for (const [id, table, label] of checks) {
      if (!id) continue;
      const [row] = await this.ncrRepo.query(
        `SELECT 1 FROM ${table} WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [id, org],
      );
      if (!row) throw new BadRequestException(`${label} not found`);
    }
    if (dto.assignedTo) {
      const [row] = await this.ncrRepo.query(
        `SELECT 1 FROM users WHERE id = $1 AND organization_id = $2 AND is_active = true LIMIT 1`,
        [dto.assignedTo, org],
      );
      if (!row) throw new BadRequestException('Assignee not found');
    }
  }

  // ── NCR ─────────────────────────────────────────────────────────────────────

  async createNcr(dto: CreateNcrDto): Promise<Ncr> {
    await this.assertLinksValid(dto);
    const actor = await this.actor();

    // Number from the MAX existing suffix within THIS org (count() drifts after
    // deletes; other tenants' numbering must not bleed in). The (org, number)
    // unique index turns allocation races into a retry.
    const year = new Date().getFullYear();
    const prefix = `NCR-${year}-`;
    for (let attempt = 0; attempt < 5; attempt++) {
      const rows: { num: string }[] = await this.ncrRepo.query(
        `SELECT number AS num FROM ncrs WHERE number LIKE $1 AND organization_id = $2 ORDER BY number DESC LIMIT 1`,
        [`${prefix}%`, this.org],
      );
      const base = rows?.[0]?.num ? parseInt(rows[0].num.slice(prefix.length), 10) || 0 : 0;
      const number = `${prefix}${String(base + 1).padStart(4, '0')}`;
      try {
        const ncr = this.ncrRepo.create({ ...(dto as any), number, organizationId: this.org, raisedBy: actor.id });
        const saved = (await this.ncrRepo.save(ncr as any)) as unknown as Ncr;

        await this.recordEvent(saved.id, NcrEventType.CREATED, { toStatus: saved.status, note: saved.title }, actor);
        if (saved.assignedTo) {
          await this.recordEvent(saved.id, NcrEventType.ASSIGNMENT, { note: 'Assigned on creation' }, actor);
        }
        await this.audit.log({
          userId: actor.id,
          action: 'ncr_create',
          entityType: 'ncr',
          entityId: saved.id,
          newValues: { number: saved.number, title: saved.title, severity: saved.severity },
        });
        await this.notify.ncrEvent({
          ncrId: saved.id, number: saved.number, title: saved.title,
          severity: saved.severity, kind: 'raised', actorUserId: actor.id,
        });
        if (saved.assignedTo) {
          await this.notify.ncrEvent({
            ncrId: saved.id, number: saved.number, title: saved.title, severity: saved.severity,
            kind: 'assigned', actorUserId: actor.id, assignedTo: saved.assignedTo,
          });
        }
        return saved;
      } catch (e: any) {
        if (e?.code === '23505') continue; // unique (org, number) race — reallocate
        throw e;
      }
    }
    throw new BadRequestException('Could not allocate a unique NCR number');
  }

  /** NCRs enriched with project name + item mark so the list reads in shop terms. */
  async listNcr(filter: NcrFilterDto = {}): Promise<(Ncr & { projectName?: string | null; itemMark?: string | null })[]> {
    const qb = this.ncrRepo.createQueryBuilder('n')
      .where('n.organization_id = :org', { org: this.org })
      .orderBy('n.created_at', 'DESC');
    if (filter.status) qb.andWhere('n.status = :status', { status: filter.status });
    if (filter.severity) qb.andWhere('n.severity = :severity', { severity: filter.severity });
    if (filter.projectId) qb.andWhere('n.project_id = :projectId', { projectId: filter.projectId });
    if (filter.assemblyNodeId) qb.andWhere('n.assembly_node_id = :nodeId', { nodeId: filter.assemblyNodeId });
    if (filter.workOrderId) qb.andWhere('n.work_order_id = :woId', { woId: filter.workOrderId });
    if (filter.assignedTo) qb.andWhere('n.assigned_to = :assignee', { assignee: filter.assignedTo });
    if (filter.open === 'true') qb.andWhere('n.status NOT IN (:...done)', { done: [NcrStatus.CLOSED, NcrStatus.CANCELLED] });
    if (filter.q) qb.andWhere('(n.number ILIKE :q OR n.title ILIKE :q)', { q: `%${filter.q}%` });
    const rows = await qb.getMany();

    const projectIds = [...new Set(rows.map((r) => r.projectId).filter((x): x is string => !!x))];
    const nodeIds = [...new Set(rows.map((r) => r.assemblyNodeId).filter((x): x is string => !!x))];
    const projects: { id: string; name: string }[] = projectIds.length
      ? await this.ncrRepo.query(`SELECT id, name FROM projects WHERE id = ANY($1)`, [projectIds])
      : [];
    const nodes: { id: string; mark: string | null; name: string | null }[] = nodeIds.length
      ? await this.ncrRepo.query(`SELECT id, mark, name FROM assembly_nodes WHERE id = ANY($1)`, [nodeIds])
      : [];
    const pById = new Map(projects.map((p) => [p.id, p.name]));
    const nById = new Map(nodes.map((n) => [n.id, n.mark || n.name || null]));
    return rows.map((r) => ({
      ...r,
      projectName: r.projectId ? pById.get(r.projectId) ?? null : null,
      itemMark: r.assemblyNodeId ? nById.get(r.assemblyNodeId) ?? null : null,
    }));
  }

  async getNcr(id: string): Promise<Ncr> {
    const n = await this.ncrRepo.findOne({ where: { id, organizationId: this.org } as any });
    if (!n) throw new NotFoundException('NCR not found');
    return n;
  }

  /**
   * Update / transition an NCR. Status changes follow the workflow state
   * machine (see ncr-workflow.ts): closing requires a disposition, reopening a
   * closed NCR returns it to investigation and clears the close stamp.
   */
  async updateNcr(id: string, dto: UpdateNcrDto): Promise<Ncr> {
    const n = await this.getNcr(id);
    const actor = await this.actor();
    const fromStatus = n.status;
    const prevAssignee = n.assignedTo;
    const prevDisposition = n.disposition;

    if (dto.assignedTo) {
      await this.assertLinksValid({ assignedTo: dto.assignedTo });
    }

    if (dto.status !== undefined && dto.status !== fromStatus) {
      const err = ncrTransitionError(fromStatus, dto.status, dto.disposition ?? n.disposition);
      if (err) throw new BadRequestException(err);
    }

    Object.assign(n, dto);

    if (dto.status !== undefined && dto.status !== fromStatus) {
      if (dto.status === NcrStatus.CLOSED) {
        n.closedAt = new Date();
        n.closedBy = actor.id;
      } else if (fromStatus === NcrStatus.CLOSED) {
        // Reopen: the record of the (wrong) close stays in the timeline.
        n.closedAt = null;
        n.closedBy = null;
      }
    }

    const saved = await this.ncrRepo.save(n);

    // Timeline + audit + notifications (after the write).
    if (dto.status !== undefined && dto.status !== fromStatus) {
      await this.recordEvent(id, NcrEventType.STATUS_CHANGE, {
        fromStatus, toStatus: dto.status, note: dto.dispositionNote ?? null,
      }, actor);
      await this.notify.ncrEvent({
        ncrId: id, number: saved.number, title: saved.title, severity: saved.severity,
        kind: 'status', status: dto.status, actorUserId: actor.id,
      });
    }
    if (dto.disposition !== undefined && dto.disposition !== prevDisposition) {
      await this.recordEvent(id, NcrEventType.DISPOSITION, {
        note: `${dto.disposition}${dto.dispositionNote ? ` — ${dto.dispositionNote}` : ''}`,
      }, actor);
    }
    if (dto.assignedTo !== undefined && dto.assignedTo !== prevAssignee) {
      await this.recordEvent(id, NcrEventType.ASSIGNMENT, { note: dto.assignedTo ? 'Reassigned' : 'Unassigned' }, actor);
      if (dto.assignedTo) {
        await this.notify.ncrEvent({
          ncrId: id, number: saved.number, title: saved.title, severity: saved.severity,
          kind: 'assigned', actorUserId: actor.id, assignedTo: dto.assignedTo,
        });
      }
    }
    await this.audit.log({
      userId: actor.id,
      action: 'ncr_update',
      entityType: 'ncr',
      entityId: id,
      oldValues: { status: fromStatus, disposition: prevDisposition, assignedTo: prevAssignee },
      newValues: { ...dto },
    });
    return saved;
  }

  /** Append-only timeline (creation, transitions, dispositions, assignments, comments). */
  async listEvents(ncrId: string): Promise<NcrEvent[]> {
    await this.getNcr(ncrId); // tenant + existence check
    return this.eventRepo.find({
      where: { ncrId, organizationId: this.org } as any,
      order: { createdAt: 'ASC' } as any,
    });
  }

  async addComment(ncrId: string, note: string): Promise<NcrEvent> {
    const text = (note ?? '').trim();
    if (!text) throw new BadRequestException('Comment cannot be empty');
    await this.getNcr(ncrId);
    return this.recordEvent(ncrId, NcrEventType.COMMENT, { note: text });
  }

  // ── CAPA ────────────────────────────────────────────────────────────────────

  async createCapa(dto: CreateCapaDto): Promise<Capa> {
    if (dto.ncrId) await this.getNcr(dto.ncrId); // must be ours
    return (await this.capaRepo.save(this.capaRepo.create({ ...(dto as any), organizationId: this.org }) as any)) as unknown as Capa;
  }

  listCapa(ncrId?: string): Promise<Capa[]> {
    const where: any = { organizationId: this.org };
    if (ncrId) where.ncrId = ncrId;
    return this.capaRepo.find({ where, order: { createdAt: 'DESC' } as any });
  }

  /**
   * Update / transition a CAPA. Verification is a precondition for closing;
   * the verifier is stamped from the authenticated user.
   */
  async updateCapa(id: string, dto: UpdateCapaDto): Promise<Capa> {
    const c = await this.capaRepo.findOne({ where: { id, organizationId: this.org } as any });
    if (!c) throw new NotFoundException('CAPA not found');
    const fromStatus = c.status;

    if (dto.status !== undefined && dto.status !== fromStatus) {
      const err = capaTransitionError(fromStatus, dto.status);
      if (err) throw new BadRequestException(err);
    }

    Object.assign(c, dto);

    if (dto.status !== undefined && dto.status !== fromStatus) {
      const actor = await this.actor();
      if (dto.status === CapaStatus.VERIFIED) {
        c.verifiedBy = actor.id;
        c.verifiedAt = new Date();
      } else if (fromStatus === CapaStatus.VERIFIED && dto.status === CapaStatus.IN_PROGRESS) {
        c.verifiedBy = null; // verification walked back
        c.verifiedAt = null;
      }
      if (dto.status === CapaStatus.CLOSED && !c.closedAt) c.closedAt = new Date();
      await this.audit.log({
        userId: actor.id,
        action: 'capa_status_change',
        entityType: 'capa',
        entityId: id,
        oldValues: { status: fromStatus },
        newValues: { status: dto.status },
      });
    }
    return this.capaRepo.save(c);
  }
}
