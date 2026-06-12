import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { QualityData } from './quality-data.entity.js';
import { CreateQualityDataDto } from './dto/create-quality-data.dto.js';
import { UpdateQualityDataDto } from './dto/update-quality-data.dto.js';
import { BulkCreateQualityDataDto } from './dto/bulk-create-quality-data.dto.js';
import { PageOptionsDto, PageDto, PageMetaDto } from '../common/dto/pagination.dto.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import type { StorageProvider } from '../storage/storage.interface.js';
import { STORAGE_PROVIDER } from '../storage/storage.interface.js';
import { applyAutoFail, evaluateTolerance, requiresSignoff } from './quality-math.js';
import { User } from '../auth/entities/user.entity.js';
import { AuditService } from '../audit/audit.service.js';
import { QualityNotifyService } from '../quality-notify/quality-notify.service.js';

/** Evidence uploads must be images — keep in step with the controller's interceptor. */
export const EVIDENCE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const EVIDENCE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

@Injectable()
export class QualityDataService {
  constructor(
    @InjectRepository(QualityData) private readonly repo: Repository<QualityData>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly audit: AuditService,
    private readonly notify: QualityNotifyService,
  ) {}

  // ── Tenant scoping ──────────────────────────────────────────────────────────
  // Every read/write is bound to the caller's organization. Lenient only for
  // org-less system contexts (jobs); RLS remains the DB-level backstop.

  private get org(): string | null {
    return TenantContext.getOrganizationId();
  }

  private get userId(): string | null {
    return TenantContext.get()?.userId ?? null;
  }

  private scoped(alias = 'qd'): SelectQueryBuilder<QualityData> {
    const qb = this.repo.createQueryBuilder(alias).where(`${alias}.is_active = :active`, { active: true });
    const org = this.org;
    if (org) qb.andWhere(`${alias}.organization_id = :org`, { org });
    return qb;
  }

  private async currentUser(): Promise<User | null> {
    const id = this.userId;
    if (!id) return null;
    return this.userRepo.findOne({ where: { id } as any });
  }

  private displayName(u: User | null): string | null {
    if (!u) return null;
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
    return name || u.email || null;
  }

  /** The entry's shop-floor label for alerts/messages. */
  private labelOf(item: QualityData): string {
    return item.regionLabel || item.meshName || `entry ${item.id.slice(0, 8)}`;
  }

  /**
   * Referential guard: the linked model must exist, and the linked assembly
   * node / project must belong to the caller's organization. Stops quality
   * rows from being attached to other tenants' records.
   */
  private async assertLinksValid(dto: {
    modelId?: string;
    assemblyNodeId?: string | null;
    projectId?: string | null;
  }): Promise<void> {
    const org = this.org;
    if (dto.modelId) {
      const [m] = await this.repo.query(`SELECT 1 FROM models WHERE id = $1 LIMIT 1`, [dto.modelId]);
      if (!m) throw new BadRequestException('Linked 3D model not found');
    }
    if (dto.assemblyNodeId) {
      const [n] = org
        ? await this.repo.query(`SELECT 1 FROM assembly_nodes WHERE id = $1 AND organization_id = $2 LIMIT 1`, [dto.assemblyNodeId, org])
        : await this.repo.query(`SELECT 1 FROM assembly_nodes WHERE id = $1 LIMIT 1`, [dto.assemblyNodeId]);
      if (!n) throw new BadRequestException('Linked assembly item not found');
    }
    if (dto.projectId) {
      const [p] = org
        ? await this.repo.query(`SELECT 1 FROM projects WHERE id = $1 AND organization_id = $2 LIMIT 1`, [dto.projectId, org])
        : await this.repo.query(`SELECT 1 FROM projects WHERE id = $1 LIMIT 1`, [dto.projectId]);
      if (!p) throw new BadRequestException('Linked project not found');
    }
  }

  // ── Reads ───────────────────────────────────────────────────────────────────

  async findAll(pageOptions: PageOptionsDto, modelId?: string): Promise<PageDto<QualityData>> {
    const qb = this.scoped()
      .leftJoinAndSelect('qd.model', 'model')
      .orderBy('qd.createdAt', pageOptions.order)
      .skip(pageOptions.skip)
      .take(pageOptions.limit);
    if (modelId) qb.andWhere('qd.model_id = :modelId', { modelId });
    const [items, count] = await qb.getManyAndCount();
    return new PageDto(items, new PageMetaDto(pageOptions, count));
  }

  async findByModel(modelId: string): Promise<QualityData[]> {
    return this.scoped()
      .andWhere('qd.model_id = :modelId', { modelId })
      .orderBy('qd.created_at', 'DESC')
      .getMany();
  }

  async findOne(id: string): Promise<QualityData> {
    const qb = this.repo.createQueryBuilder('qd')
      .leftJoinAndSelect('qd.model', 'model')
      .where('qd.id = :id', { id });
    const org = this.org;
    if (org) qb.andWhere('qd.organization_id = :org', { org });
    const item = await qb.getOne();
    if (!item) throw new NotFoundException('Quality data not found');
    return item;
  }

  async getSummary(modelId: string): Promise<{ total: number; pass: number; fail: number; warning: number }> {
    const batch = await this.getSummaryBatch([modelId]);
    return batch[modelId] ?? { total: 0, pass: 0, fail: 0, warning: 0 };
  }

  /** Pass/fail/warning counts for many models at once (for status chips on cards). */
  async getSummaryBatch(
    modelIds: string[],
  ): Promise<Record<string, { total: number; pass: number; fail: number; warning: number }>> {
    const result: Record<string, { total: number; pass: number; fail: number; warning: number }> = {};
    if (!modelIds.length) return result;
    for (const id of modelIds) result[id] = { total: 0, pass: 0, fail: 0, warning: 0 };

    const rows = await this.scoped()
      .select('qd.model_id', 'modelId')
      .addSelect('qd.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .andWhere('qd.model_id IN (:...ids)', { ids: modelIds })
      .groupBy('qd.model_id')
      .addGroupBy('qd.status')
      .getRawMany();

    for (const r of rows) {
      const bucket = result[r.modelId] || (result[r.modelId] = { total: 0, pass: 0, fail: 0, warning: 0 });
      const count = parseInt(r.count, 10) || 0;
      if (r.status === 'pass' || r.status === 'fail' || r.status === 'warning') {
        bucket[r.status as 'pass' | 'fail' | 'warning'] += count;
      }
      bucket.total += count;
    }
    return result;
  }

  /** Trend tracking — quality status over time grouped by inspection date. */
  async getTrends(modelId: string): Promise<any[]> {
    return this.scoped()
      .select('DATE(qd.inspection_date)', 'date')
      .addSelect('qd.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .andWhere('qd.model_id = :modelId', { modelId })
      .andWhere('qd.inspection_date IS NOT NULL')
      .groupBy('DATE(qd.inspection_date)')
      .addGroupBy('qd.status')
      .orderBy('DATE(qd.inspection_date)', 'ASC')
      .getRawMany();
  }

  /** Defect pattern analysis — recurring failures by mesh region. */
  async getDefectPatterns(modelId: string): Promise<any[]> {
    return this.scoped()
      .select('qd.mesh_name', 'meshName')
      .addSelect('qd.region_label', 'regionLabel')
      .addSelect('qd.defect_type', 'defectType')
      .addSelect('COUNT(*)', 'occurrences')
      .addSelect("AVG(CASE WHEN qd.status = 'fail' THEN 1 ELSE 0 END) * 100", 'failRate')
      .andWhere('qd.model_id = :modelId', { modelId })
      .groupBy('qd.mesh_name')
      .addGroupBy('qd.region_label')
      .addGroupBy('qd.defect_type')
      .having('COUNT(*) > 1')
      .orderBy('COUNT(*)', 'DESC')
      .getRawMany();
  }

  /** Items pending sign-off (failed entries awaiting a decision). */
  async getPendingSignoffs(modelId?: string): Promise<QualityData[]> {
    const qb = this.scoped()
      .leftJoinAndSelect('qd.model', 'model')
      .andWhere('qd.signoff_status = :pending', { pending: 'pending' })
      .andWhere('qd.status = :fail', { fail: 'fail' })
      .orderBy('qd.created_at', 'DESC');
    if (modelId) qb.andWhere('qd.model_id = :modelId', { modelId });
    return qb.getMany();
  }

  // ── Writes ──────────────────────────────────────────────────────────────────

  /** Stamp identity + apply the auto-fail tolerance rule to one DTO. */
  private async prepare(dto: CreateQualityDataDto, user: User | null): Promise<Partial<QualityData>> {
    const status = applyAutoFail(dto.status, dto.measurementValue, dto.toleranceMin, dto.toleranceMax);
    return {
      ...dto,
      status,
      inspector: dto.inspector || this.displayName(user) || undefined,
      inspectorUserId: user?.id ?? null,
      inspectionDate: dto.inspectionDate ? new Date(dto.inspectionDate) : new Date(),
      organizationId: this.org,
    } as Partial<QualityData>;
  }

  private async afterCreate(saved: QualityData, dto: CreateQualityDataDto): Promise<void> {
    if (saved.status === 'fail') {
      const autoFailed =
        dto.status !== 'fail' && !evaluateTolerance(dto.measurementValue, dto.toleranceMin, dto.toleranceMax).inTolerance;
      await this.notify.inspectionFailed({
        qualityDataId: saved.id,
        label: this.labelOf(saved),
        severity: saved.severity ?? null,
        autoFailed,
        inspectorUserId: saved.inspectorUserId,
      });
    }
  }

  /** Create one inspection entry (auto-fails out-of-tolerance measurements). */
  async create(dto: CreateQualityDataDto): Promise<QualityData> {
    await this.assertLinksValid(dto);
    const user = await this.currentUser();
    const saved = await this.repo.save(this.repo.create(await this.prepare(dto, user)));
    await this.afterCreate(saved, dto);
    return saved;
  }

  /** Bulk create — same identity stamping + auto-fail rule as single create. */
  async bulkCreate(dto: BulkCreateQualityDataDto): Promise<QualityData[]> {
    if (!dto.items.length) return [];
    // Validate distinct links once instead of per row.
    const modelIds = [...new Set(dto.items.map((i) => i.modelId).filter(Boolean))];
    const nodeIds = [...new Set(dto.items.map((i) => i.assemblyNodeId).filter((x): x is string => !!x))];
    const projectIds = [...new Set(dto.items.map((i) => i.projectId).filter((x): x is string => !!x))];
    for (const modelId of modelIds) await this.assertLinksValid({ modelId });
    for (const assemblyNodeId of nodeIds) await this.assertLinksValid({ assemblyNodeId });
    for (const projectId of projectIds) await this.assertLinksValid({ projectId });

    const user = await this.currentUser();
    const entities = await Promise.all(dto.items.map(async (item) => this.repo.create(await this.prepare(item, user))));
    const saved = await this.repo.save(entities);
    for (let i = 0; i < saved.length; i++) await this.afterCreate(saved[i], dto.items[i]);
    return saved;
  }

  /**
   * Update an entry. Linkage (model/node/project) is immutable after creation;
   * measurements are re-checked against tolerances so an edit can't sneak an
   * out-of-tolerance value back to "pass".
   */
  async update(id: string, dto: UpdateQualityDataDto): Promise<QualityData> {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    item.status = applyAutoFail(item.status, item.measurementValue, item.toleranceMin, item.toleranceMax);
    // A failed entry that was already decided returns to the review queue when re-failed after edit.
    if (requiresSignoff(item.status) && dto.status && item.signoffStatus === 'rejected') {
      item.signoffStatus = 'pending';
    }
    return this.repo.save(item);
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    item.isActive = false; // soft delete preserves the audit trail
    await this.repo.save(item);
    await this.audit.log({
      userId: this.userId,
      action: 'quality_data_delete',
      entityType: 'quality_data',
      entityId: id,
      newValues: { isActive: false },
    });
  }

  async removeByModel(modelId: string): Promise<void> {
    // Soft delete, tenant-scoped — never touches another organization's rows.
    const where: Record<string, any> = { modelId };
    if (this.org) where.organizationId = this.org;
    await this.repo.update(where, { isActive: false });
    await this.audit.log({
      userId: this.userId,
      action: 'quality_data_delete_by_model',
      entityType: 'quality_data',
      entityId: modelId,
      newValues: { modelId, isActive: false },
    });
  }

  /**
   * Sign-off decision on a (failed) entry. The decider's identity comes from
   * the authenticated context — client-supplied names are ignored.
   */
  async signoff(id: string, status: 'approved' | 'rejected', notes?: string): Promise<QualityData> {
    if (status !== 'approved' && status !== 'rejected') {
      throw new BadRequestException("Sign-off status must be 'approved' or 'rejected'");
    }
    const item = await this.findOne(id);
    const user = await this.currentUser();
    const previous = item.signoffStatus;

    item.signoffStatus = status;
    item.signoffBy = this.displayName(user);
    item.signoffByUserId = user?.id ?? null;
    item.signoffDate = new Date();
    if (notes) item.signoffNotes = notes;
    const saved = await this.repo.save(item);

    await this.audit.log({
      userId: this.userId,
      action: 'quality_signoff',
      entityType: 'quality_data',
      entityId: id,
      oldValues: { signoffStatus: previous },
      newValues: { signoffStatus: status, notes: notes ?? null },
    });
    await this.notify.signoffDecided({
      qualityDataId: saved.id,
      label: this.labelOf(saved),
      decision: status,
      deciderName: this.displayName(user),
      inspectorUserId: saved.inspectorUserId,
    });
    return saved;
  }

  // ── Evidence attachments ────────────────────────────────────────────────────

  /**
   * Attach a client-captured evidence image (e.g. an AR snapshot of the overlay
   * on the real part). Images only; stored via the shared storage provider and
   * keyed on the entry's `attachments` array.
   */
  async addEvidence(id: string, file: Express.Multer.File): Promise<QualityData> {
    const item = await this.findOne(id);
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    const mimeOk = EVIDENCE_MIME_TYPES.includes((file.mimetype || '').toLowerCase());
    const extOk = EVIDENCE_EXTENSIONS.includes(ext);
    if (!mimeOk || !extOk) {
      try { fs.unlinkSync(file.path); } catch { /* staging cleanup best-effort */ }
      throw new BadRequestException('Evidence must be a JPEG, PNG or WebP image');
    }
    const key = `quality-evidence/${item.id}/${crypto.randomUUID()}${ext}`;
    await this.storage.upload(file.path, key, file.mimetype || 'image/jpeg');
    try { fs.unlinkSync(file.path); } catch { /* staging cleanup best-effort */ }
    item.attachments = [...(item.attachments ?? []), key];
    return this.repo.save(item);
  }

  /** Stream a stored evidence attachment by its index in the entry. */
  async getEvidenceStream(
    id: string,
    index: number,
  ): Promise<{ stream: NodeJS.ReadableStream; key: string }> {
    const item = await this.findOne(id);
    const key = item.attachments?.[index];
    if (!key) throw new NotFoundException('Evidence not found');
    const stream = await this.storage.download(key);
    return { stream, key };
  }
}
