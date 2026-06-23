import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QualityReport, QualityReportStatus } from './quality-report.entity.js';
import { QualityReportEvent } from './quality-report-event.entity.js';
import { FormTemplate } from '../templates/entities/form-template.entity.js';
import { ProductionOrder } from '../projects/production-order.entity.js';
import { AssemblyNode } from '../projects/assembly-node.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import {
  type NcrStatus,
  isNcrDisposition,
  canRecordDisposition,
  requiresReinspection,
  requiresConcession,
  assertCloseable,
} from './ncr-workflow.js';
import { QualityNotifyService } from '../quality-notify/quality-notify.service.js';

export interface CreateReportInput {
  templateId: string;
  productionOrderId: string;
  assemblyNodeId?: string;
  /** When spawned from a failed inspection: the source quality_data row + pre-filled values. */
  sourceQualityDataId?: string;
  initialData?: Record<string, any>;
}
export interface UpdateReportInput {
  data?: Record<string, any>;
  status?: string;
}
export interface DispositionInput {
  disposition: string;
  dispositionNotes?: string;
  rootCause?: string;
  correctiveAction?: string;
  /** Authorized concession justification — required to close repair / use-as-is. */
  concessionReason?: string;
}

type EventType =
  | 'created' | 'submitted' | 'status' | 'disposition'
  | 'comment' | 'resolved' | 'reopened' | 'cancelled' | 'linked';

/**
 * QC reports: instances of drag-drop FormTemplates filled against a production
 * work order. `ncr`-type reports carry a full non-conformance lifecycle
 * (open → under_review → dispositioned → closed/cancelled) with a disposition
 * (rework/repair/use-as-is/scrap/return), an append-only activity log, and a
 * rework re-inspection gate before close. The shipping + quality-stage gates
 * stay keyed on `resolvedAt IS NULL` — only CLOSE and CANCEL stamp it.
 */
@Injectable()
export class QualityReportsService {
  constructor(
    @InjectRepository(QualityReport) private readonly repo: Repository<QualityReport>,
    @InjectRepository(QualityReportEvent) private readonly eventRepo: Repository<QualityReportEvent>,
    @InjectRepository(FormTemplate) private readonly templateRepo: Repository<FormTemplate>,
    @InjectRepository(ProductionOrder) private readonly orderRepo: Repository<ProductionOrder>,
    @InjectRepository(AssemblyNode) private readonly nodeRepo: Repository<AssemblyNode>,
    private readonly notify: QualityNotifyService,
  ) {}

  private get org(): string { return TenantContext.requireOrganizationId(); }
  private get userId(): string | null { return TenantContext.get()?.userId ?? null; }

  /** Create a BLANK report from a template against a work order (status: draft). */
  async create(input: CreateReportInput): Promise<QualityReport> {
    const org = this.org;
    const template = await this.templateRepo.findOne({ where: { id: input.templateId, organizationId: org } });
    if (!template) throw new NotFoundException('Template not found');
    const order = await this.orderRepo.findOne({ where: { id: input.productionOrderId, organizationId: org } });
    if (!order) throw new NotFoundException('Work order not found');
    let node: AssemblyNode | null = null;
    if (input.assemblyNodeId) {
      node = await this.nodeRepo.findOne({ where: { id: input.assemblyNodeId, organizationId: org } });
      if (!node) throw new NotFoundException('Item not found');
    }

    const isNcr = (template.type ?? null) === 'ncr';
    const year = new Date().getFullYear();
    const prefix = `QR-${year}-`;
    for (let attempt = 0; attempt < 5; attempt++) {
      const rows: { num: string }[] = await this.repo.query(
        `SELECT number AS num FROM quality_reports WHERE number LIKE $1 AND organization_id = $2 ORDER BY number DESC LIMIT 1`,
        [`${prefix}%`, org],
      );
      const base = rows?.[0]?.num ? parseInt(rows[0].num.slice(prefix.length), 10) || 0 : 0;
      try {
        const saved = await this.repo.save(this.repo.create({
          number: `${prefix}${String(base + 1).padStart(4, '0')}`,
          templateId: template.id,
          templateName: template.name,
          templateType: template.type ?? null,
          templateSchema: template.schema ?? { components: [] },
          productionOrderId: order.id,
          projectId: order.projectId,
          assemblyNodeId: node?.id ?? null,
          data: input.initialData ?? null,
          sourceQualityDataId: input.sourceQualityDataId ?? null,
          status: QualityReportStatus.DRAFT,
          ncrStatus: isNcr ? 'open' : null,
          filledBy: this.userId,
          organizationId: org,
        }));
        if (isNcr) {
          await this.appendEvent(saved, 'created', { toStatus: 'open' });
          await this.notify.ncrRaised({
            reportId: saved.id,
            number: saved.number,
            label: node?.mark ?? node?.name ?? saved.number,
            assemblyNodeId: saved.assemblyNodeId,
            productionOrderId: saved.productionOrderId,
            severity: (input.initialData?.['severity'] as string) ?? null,
            raisedByUserId: this.userId,
          });
        }
        return saved;
      } catch (e: any) {
        if (e?.code === '23505') continue;
        throw e;
      }
    }
    throw new BadRequestException('Could not allocate a unique report number');
  }

  /**
   * Raise an NCR FROM a failed inspection: pulls the failure context off the
   * `quality_data` row to pre-fill the NCR form and links the two records
   * (`sourceQualityDataId`) for the §8.7 audit trail. The spawned NCR is a normal
   * `ncr`-type report, so it inherits all gate behaviour automatically.
   */
  async createFromInspection(input: {
    qualityDataId: string;
    templateId: string;
    productionOrderId: string;
    assemblyNodeId?: string;
  }): Promise<QualityReport> {
    const org = this.org;
    const rows: {
      id: string; defect_type: string | null; severity: string | null; mesh_name: string | null;
      notes: string | null; measurement_value: number | null; measurement_unit: string | null;
      tolerance_min: number | null; tolerance_max: number | null;
      assembly_node_id: string | null;
    }[] = await this.repo.query(
      `SELECT id, defect_type, severity, mesh_name, notes, measurement_value, measurement_unit,
              tolerance_min, tolerance_max, assembly_node_id
         FROM quality_data WHERE id = $1 AND organization_id = $2`,
      [input.qualityDataId, org],
    );
    const qd = rows?.[0];
    if (!qd) throw new NotFoundException('Source inspection not found');

    const label = qd.mesh_name || 'item';
    const measure = qd.measurement_value != null
      ? ` Measured ${qd.measurement_value}${qd.measurement_unit ?? ''}` +
        (qd.tolerance_min != null || qd.tolerance_max != null
          ? ` (tolerance ${qd.tolerance_min ?? '—'}…${qd.tolerance_max ?? '—'})` : '') + '.'
      : '';
    const initialData: Record<string, any> = {
      defectType: qd.defect_type ?? undefined,
      severity: qd.severity ?? undefined,
      description:
        `Raised from a failed inspection on ${label}.` +
        (qd.notes ? ` ${qd.notes}` : '') + measure,
    };

    const report = await this.create({
      templateId: input.templateId,
      productionOrderId: input.productionOrderId,
      assemblyNodeId: input.assemblyNodeId ?? qd.assembly_node_id ?? undefined,
      sourceQualityDataId: qd.id,
      initialData,
    });
    await this.appendEvent(report, 'linked', { note: `Raised from inspection ${qd.id}` });
    return this.get(report.id) as any;
  }

  /** Reports enriched with order/project/item context, newest first. */
  async list(filter: { productionOrderId?: string; projectId?: string; status?: string }) {
    const org = this.org;
    const where: any = { organizationId: org };
    if (filter.productionOrderId) where.productionOrderId = filter.productionOrderId;
    if (filter.projectId) where.projectId = filter.projectId;
    if (filter.status) where.status = filter.status;
    const rows = await this.repo.find({ where, order: { createdAt: 'DESC' } });
    return this.enrich(rows);
  }

  async get(id: string) {
    const r = await this.repo.findOne({ where: { id, organizationId: this.org } });
    if (!r) throw new NotFoundException('Report not found');
    const [enriched] = await this.enrich([r]);
    return enriched;
  }

  /** Save filled values; submitting stamps who/when. Submitted reports stay editable (corrections). */
  async update(id: string, input: UpdateReportInput): Promise<QualityReport> {
    const r = await this.repo.findOne({ where: { id, organizationId: this.org } });
    if (!r) throw new NotFoundException('Report not found');
    if (input.data !== undefined) r.data = input.data;
    let didSubmit = false;
    if (input.status !== undefined) {
      if (!Object.values(QualityReportStatus).includes(input.status as QualityReportStatus)) {
        throw new BadRequestException(`Invalid status '${input.status}'`);
      }
      const was = r.status;
      r.status = input.status as QualityReportStatus;
      if (r.status === QualityReportStatus.SUBMITTED) {
        r.submittedAt = r.submittedAt ?? new Date();
        r.filledBy = this.userId ?? r.filledBy;
        didSubmit = was !== QualityReportStatus.SUBMITTED;
      }
    }
    const saved = await this.repo.save(r);
    if (didSubmit && saved.templateType === 'ncr') await this.appendEvent(saved, 'submitted');
    return saved;
  }

  /** Move an open NCR into "under review" (an inspector is working on it). */
  async startReview(id: string, note?: string): Promise<QualityReport> {
    const r = await this.requireNcr(id);
    if (r.ncrStatus !== 'open') throw new BadRequestException('Only an open NCR can be moved to review.');
    const from = (r.ncrStatus ?? 'open') as NcrStatus;
    r.ncrStatus = 'under_review';
    const saved = await this.repo.save(r);
    await this.appendEvent(saved, 'status', { fromStatus: from, toStatus: 'under_review', note });
    await this.notify.ncrLifecycle({
      reportId: saved.id, number: saved.number, kind: 'under_review', ncrStatus: 'under_review',
      assemblyNodeId: saved.assemblyNodeId, productionOrderId: saved.productionOrderId,
    });
    return this.get(id) as any;
  }

  /**
   * Record (or revise) the Material-Review disposition for an NCR. Captures the
   * deciding authority (disposition_by/at) and any root-cause / corrective-action
   * found. Does NOT lift the gate — the NCR is closed separately, after the
   * disposition is carried out (and re-inspected, for rework/repair).
   */
  async recordDisposition(id: string, input: DispositionInput): Promise<QualityReport> {
    const r = await this.requireNcr(id);
    if (!isNcrDisposition(input.disposition)) {
      throw new BadRequestException('Invalid disposition. Use rework, repair, use_as_is, scrap or return_to_supplier.');
    }
    if (!canRecordDisposition((r.ncrStatus ?? 'open') as NcrStatus)) {
      throw new BadRequestException('A closed or cancelled NCR cannot be dispositioned — reopen it first.');
    }
    const from = (r.ncrStatus ?? 'open') as NcrStatus;
    r.disposition = input.disposition;
    r.dispositionNotes = input.dispositionNotes?.trim() || null;
    if (input.rootCause !== undefined) r.rootCause = input.rootCause?.trim() || null;
    if (input.correctiveAction !== undefined) r.correctiveAction = input.correctiveAction?.trim() || null;
    // Concession authorization for repair / use-as-is (a deviation from spec).
    if (requiresConcession(input.disposition) && input.concessionReason?.trim()) {
      r.concessionBy = this.userId;
      r.concessionReason = input.concessionReason.trim();
    }
    r.dispositionBy = this.userId;
    r.dispositionAt = new Date();
    r.ncrStatus = 'dispositioned';
    const saved = await this.repo.save(r);
    await this.appendEvent(saved, 'disposition', {
      fromStatus: from, toStatus: 'dispositioned', disposition: input.disposition,
      note: input.dispositionNotes?.trim() || undefined,
    });
    await this.notify.ncrLifecycle({
      reportId: saved.id, number: saved.number, kind: 'dispositioned', ncrStatus: 'dispositioned',
      assemblyNodeId: saved.assemblyNodeId, productionOrderId: saved.productionOrderId,
    });
    return this.get(id) as any;
  }

  /**
   * Resolve (CLOSE) an NCR — lifts the shipping + quality-stage gates. Requires a
   * disposition first, and (for rework/repair) a passing re-inspection recorded
   * after the disposition. Kept named `resolve` for API/client compatibility.
   */
  async resolve(id: string): Promise<QualityReport> {
    const r = await this.requireNcr(id);
    const status = (r.ncrStatus ?? (r.resolvedAt ? 'closed' : 'open')) as NcrStatus;
    const hasReinspection = requiresReinspection(r.disposition)
      ? await this.hasPassingReinspection(r)
      : true;
    const verdict = assertCloseable({
      status,
      disposition: r.disposition,
      hasPassingReinspection: hasReinspection,
      hasConcession: !!(r.concessionBy && r.concessionReason),
    });
    if (!verdict.ok) throw new BadRequestException(verdict.reason);

    r.ncrStatus = 'closed';
    r.resolvedAt = new Date();
    r.resolvedBy = this.userId;
    const saved = await this.repo.save(r);
    await this.appendEvent(saved, 'resolved', { fromStatus: status, toStatus: 'closed' });
    await this.notify.ncrLifecycle({
      reportId: saved.id, number: saved.number, kind: 'closed', ncrStatus: 'closed',
      assemblyNodeId: saved.assemblyNodeId, productionOrderId: saved.productionOrderId,
    });
    return this.get(id) as any;
  }

  /** Reopen a closed NCR (re-blocks its gates) — back into "under review". */
  async reopen(id: string): Promise<QualityReport> {
    const r = await this.requireNcr(id);
    if (r.ncrStatus !== 'closed' && !r.resolvedAt) {
      throw new BadRequestException('Only a closed NCR can be reopened.');
    }
    r.ncrStatus = 'under_review';
    r.resolvedAt = null;
    r.resolvedBy = null;
    const saved = await this.repo.save(r);
    await this.appendEvent(saved, 'reopened', { fromStatus: 'closed', toStatus: 'under_review' });
    await this.notify.ncrLifecycle({
      reportId: saved.id, number: saved.number, kind: 'reopened', ncrStatus: 'under_review',
      assemblyNodeId: saved.assemblyNodeId, productionOrderId: saved.productionOrderId,
    });
    return this.get(id) as any;
  }

  /** Cancel an NCR raised in error — lifts the gate but records it as voided (not a real NC). */
  async cancel(id: string, note?: string): Promise<QualityReport> {
    const r = await this.requireNcr(id);
    if (r.ncrStatus === 'closed' || r.resolvedAt) {
      throw new BadRequestException('A closed NCR cannot be cancelled — reopen it first if it needs further work.');
    }
    if (r.ncrStatus === 'cancelled') return this.get(id) as any;
    const from = (r.ncrStatus ?? 'open') as NcrStatus;
    r.ncrStatus = 'cancelled';
    r.resolvedAt = new Date();
    r.resolvedBy = this.userId;
    const saved = await this.repo.save(r);
    await this.appendEvent(saved, 'cancelled', { fromStatus: from, toStatus: 'cancelled', note });
    await this.notify.ncrLifecycle({
      reportId: saved.id, number: saved.number, kind: 'cancelled', ncrStatus: 'cancelled',
      assemblyNodeId: saved.assemblyNodeId, productionOrderId: saved.productionOrderId,
    });
    return this.get(id) as any;
  }

  /** Add a comment to an NCR's activity log (no status change). */
  async addComment(id: string, note: string): Promise<{ ok: true }> {
    const r = await this.requireNcr(id);
    const text = (note ?? '').trim();
    if (!text) throw new BadRequestException('Comment cannot be empty.');
    await this.appendEvent(r, 'comment', { note: text });
    return { ok: true };
  }

  /** The NCR activity timeline (oldest first), with author display names resolved. */
  async events(id: string) {
    await this.requireNcr(id); // access + existence check, org-scoped
    const rows = await this.eventRepo.find({
      where: { reportId: id, organizationId: this.org },
      order: { createdAt: 'ASC' },
    });
    const names = await this.userNames(rows.map((e) => e.createdBy).filter((x): x is string => !!x));
    return rows.map((e) => ({
      id: e.id,
      type: e.type,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      disposition: e.disposition,
      note: e.note,
      createdBy: e.createdBy,
      createdByName: e.createdBy ? names.get(e.createdBy) ?? null : null,
      createdAt: e.createdAt,
    }));
  }

  async remove(id: string): Promise<{ ok: true }> {
    const r = await this.repo.findOne({ where: { id, organizationId: this.org } });
    if (!r) throw new NotFoundException('Report not found');
    await this.repo.delete({ id, organizationId: this.org });
    return { ok: true };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async requireNcr(id: string): Promise<QualityReport> {
    const r = await this.repo.findOne({ where: { id, organizationId: this.org } });
    if (!r) throw new NotFoundException('Report not found');
    if (r.templateType !== 'ncr') throw new BadRequestException('This action only applies to NCR reports.');
    return r;
  }

  private async appendEvent(
    report: QualityReport,
    type: EventType,
    extra: { fromStatus?: string; toStatus?: string; disposition?: string; note?: string } = {},
  ): Promise<void> {
    await this.eventRepo.save(this.eventRepo.create({
      organizationId: report.organizationId,
      reportId: report.id,
      type,
      fromStatus: extra.fromStatus ?? null,
      toStatus: extra.toStatus ?? null,
      disposition: extra.disposition ?? null,
      note: extra.note ?? null,
      createdBy: this.userId,
    }));
  }

  /**
   * True iff the NCR's assembly has an acceptable (pass) inspection recorded
   * AFTER the disposition — the ISO §8.7.1 "verify the correction" check that
   * gates closing a rework/repair NCR. With no pinned assembly there is nothing
   * to re-inspect, so it cannot be auto-verified → block (decide via use-as-is).
   */
  private async hasPassingReinspection(r: QualityReport): Promise<boolean> {
    if (!r.assemblyNodeId || !r.dispositionAt) return false;
    const rows: { n: number }[] = await this.repo.query(
      `SELECT COUNT(*)::int AS n FROM quality_data
        WHERE organization_id = $1 AND assembly_node_id = $2
          AND status = 'pass' AND is_active = true AND created_at > $3`,
      [r.organizationId, r.assemblyNodeId, r.dispositionAt],
    );
    return (rows?.[0]?.n ?? 0) > 0;
  }

  private async userNames(ids: string[]): Promise<Map<string, string>> {
    const uniq = [...new Set(ids)];
    if (!uniq.length) return new Map();
    const rows: { id: string; first_name: string | null; last_name: string | null; email: string | null }[] =
      await this.repo.query(`SELECT id, first_name, last_name, email FROM users WHERE id = ANY($1)`, [uniq]);
    return new Map(rows.map((u) => [
      u.id,
      [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email || 'Unknown',
    ]));
  }

  /** Attach order number, project name, item mark and author display names. */
  private async enrich(rows: QualityReport[]) {
    if (!rows.length) return [] as any[];
    const orderIds = [...new Set(rows.map((r) => r.productionOrderId))];
    const projectIds = [...new Set(rows.map((r) => r.projectId).filter((x): x is string => !!x))];
    const nodeIds = [...new Set(rows.map((r) => r.assemblyNodeId).filter((x): x is string => !!x))];
    const userIds = [...new Set(rows.flatMap((r) => [r.filledBy, r.dispositionBy, r.resolvedBy]).filter((x): x is string => !!x))];

    const orders: { id: string; number: string; customer_name: string | null }[] = orderIds.length
      ? await this.repo.query(`SELECT id, number, customer_name FROM production_orders WHERE id = ANY($1)`, [orderIds])
      : [];
    const projects: { id: string; name: string }[] = projectIds.length
      ? await this.repo.query(`SELECT id, name FROM projects WHERE id = ANY($1)`, [projectIds])
      : [];
    const nodes: { id: string; mark: string | null; name: string | null }[] = nodeIds.length
      ? await this.repo.query(`SELECT id, mark, name FROM assembly_nodes WHERE id = ANY($1)`, [nodeIds])
      : [];
    const names = await this.userNames(userIds);

    const oById = new Map(orders.map((o) => [o.id, o]));
    const pById = new Map(projects.map((p) => [p.id, p.name]));
    const nById = new Map(nodes.map((n) => [n.id, n.mark || n.name || null]));

    return rows.map((r) => ({
      ...r,
      orderNumber: oById.get(r.productionOrderId)?.number ?? null,
      customerName: oById.get(r.productionOrderId)?.customer_name ?? null,
      projectName: r.projectId ? pById.get(r.projectId) ?? null : null,
      itemMark: r.assemblyNodeId ? nById.get(r.assemblyNodeId) ?? null : null,
      filledByName: r.filledBy ? names.get(r.filledBy) ?? null : null,
      dispositionByName: r.dispositionBy ? names.get(r.dispositionBy) ?? null : null,
      resolvedByName: r.resolvedBy ? names.get(r.resolvedBy) ?? null : null,
    }));
  }
}
