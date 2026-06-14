import { Injectable, NotFoundException, BadRequestException, ConflictException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';
import type { StorageProvider } from '../storage/storage.interface.js';
import { STORAGE_PROVIDER } from '../storage/storage.interface.js';
import { StorageKeys } from '../storage/storage-keys.js';
import { EVIDENCE_EXTENSIONS, EVIDENCE_MIME_TYPES } from '../quality-data/evidence.constants.js';
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
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
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
    // Bounded by default so the endpoint stays fast as history accumulates.
    qb.take(Math.min(Math.max(filter.limit ?? 500, 1), 1000));
    if (filter.offset) qb.skip(Math.max(filter.offset, 0));
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

    // Optimistic concurrency: a stale client must reload before mutating.
    if (dto.expectedVersion !== undefined && dto.expectedVersion !== n.version) {
      throw new ConflictException('This NCR was modified by someone else — reload and try again.');
    }
    const { expectedVersion: _ev, ...changes } = dto;

    if (changes.assignedTo) {
      await this.assertLinksValid({ assignedTo: changes.assignedTo });
    }

    if (changes.status !== undefined && changes.status !== fromStatus) {
      const err = ncrTransitionError(fromStatus, changes.status, changes.disposition ?? n.disposition);
      if (err) throw new BadRequestException(err);
      if (changes.status === NcrStatus.CLOSED) {
        await this.assertReworkVerified(n, changes.disposition ?? n.disposition);
      }
    }

    Object.assign(n, changes);

    if (changes.disposition !== undefined && changes.disposition !== prevDisposition) {
      n.dispositionedAt = new Date();
    }

    if (changes.status !== undefined && changes.status !== fromStatus) {
      if (changes.status === NcrStatus.CLOSED) {
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
    if (changes.status !== undefined && changes.status !== fromStatus) {
      await this.recordEvent(id, NcrEventType.STATUS_CHANGE, {
        fromStatus, toStatus: changes.status, note: changes.dispositionNote ?? null,
      }, actor);
      await this.notify.ncrEvent({
        ncrId: id, number: saved.number, title: saved.title, severity: saved.severity,
        kind: 'status', status: changes.status, actorUserId: actor.id,
      });
    }
    if (changes.disposition !== undefined && changes.disposition !== prevDisposition) {
      await this.recordEvent(id, NcrEventType.DISPOSITION, {
        note: `${changes.disposition}${changes.dispositionNote ? ` — ${changes.dispositionNote}` : ''}`,
      }, actor);
    }
    if (changes.assignedTo !== undefined && changes.assignedTo !== prevAssignee) {
      await this.recordEvent(id, NcrEventType.ASSIGNMENT, { note: changes.assignedTo ? 'Reassigned' : 'Unassigned' }, actor);
      if (changes.assignedTo) {
        await this.notify.ncrEvent({
          ncrId: id, number: saved.number, title: saved.title, severity: saved.severity,
          kind: 'assigned', actorUserId: actor.id, assignedTo: changes.assignedTo,
        });
      }
    }
    await this.audit.log({
      userId: actor.id,
      action: 'ncr_update',
      entityType: 'ncr',
      entityId: id,
      oldValues: { status: fromStatus, disposition: prevDisposition, assignedTo: prevAssignee },
      newValues: { ...changes },
    });
    return saved;
  }

  /**
   * Rework must be PROVEN before the NCR closes: when the disposition is
   * `rework` and the NCR is pinned to an assembly, a passing (or warning)
   * re-inspection recorded AFTER the disposition decision is required.
   */
  private async assertReworkVerified(n: Ncr, disposition: string | null | undefined): Promise<void> {
    if (disposition !== 'rework' || !n.assemblyNodeId) return;
    const since = n.dispositionedAt ?? n.createdAt;
    const [row] = await this.ncrRepo.query(
      `SELECT 1 FROM quality_data
        WHERE assembly_node_id = $1 AND organization_id = $2 AND is_active = true
          AND status IN ('pass','warning') AND created_at > $3
        LIMIT 1`,
      [n.assemblyNodeId, this.org, since],
    );
    if (!row) {
      const [node]: { mark: string | null; name: string | null }[] = await this.ncrRepo.query(
        `SELECT mark, name FROM assembly_nodes WHERE id = $1 LIMIT 1`,
        [n.assemblyNodeId],
      );
      const label = node?.mark || node?.name || 'the assembly';
      throw new BadRequestException(
        `Rework must be verified: record a passing re-inspection on ${label} (after the rework disposition) before closing this NCR.`,
      );
    }
  }

  /** Append-only timeline (creation, transitions, dispositions, assignments, comments). */
  async listEvents(ncrId: string): Promise<NcrEvent[]> {
    await this.getNcr(ncrId); // tenant + existence check
    return this.eventRepo.find({
      where: { ncrId, organizationId: this.org } as any,
      order: { createdAt: 'ASC' } as any,
      take: 1000,
    });
  }

  // ── NCR evidence images ─────────────────────────────────────────────────────

  /** Attach a photo to the NCR itself (same storage pattern as quality-data evidence). */
  async addEvidence(id: string, file: Express.Multer.File): Promise<Ncr> {
    const n = await this.getNcr(id);
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    const mimeOk = EVIDENCE_MIME_TYPES.includes((file.mimetype || '').toLowerCase());
    const extOk = EVIDENCE_EXTENSIONS.includes(ext);
    if (!mimeOk || !extOk) {
      try { fs.unlinkSync(file.path); } catch { /* staging cleanup best-effort */ }
      throw new BadRequestException('Evidence must be a JPEG, PNG or WebP image');
    }
    const key = StorageKeys.ncrEvidence(n.organizationId ?? TenantContext.getOrganizationId(), n.id, crypto.randomUUID(), ext);
    await this.storage.upload(file.path, key, file.mimetype || 'image/jpeg');
    try { fs.unlinkSync(file.path); } catch { /* staging cleanup best-effort */ }
    n.attachments = [...(n.attachments ?? []), key];
    const saved = await this.ncrRepo.save(n);
    await this.recordEvent(id, NcrEventType.COMMENT, { note: 'Photo evidence attached' });
    return saved;
  }

  /** Stream a stored NCR evidence attachment by its index. */
  async getEvidenceStream(id: string, index: number): Promise<{ stream: NodeJS.ReadableStream; key: string }> {
    const n = await this.getNcr(id);
    const key = n.attachments?.[index];
    if (!key) throw new NotFoundException('Evidence not found');
    const stream = await this.storage.download(key);
    return { stream, key };
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
