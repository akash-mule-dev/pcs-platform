import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QualityReport, QualityReportStatus } from './quality-report.entity.js';
import { FormTemplate } from '../templates/entities/form-template.entity.js';
import { ProductionOrder } from '../projects/production-order.entity.js';
import { AssemblyNode } from '../projects/assembly-node.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';

export interface CreateReportInput {
  templateId: string;
  productionOrderId: string;
  assemblyNodeId?: string;
}
export interface UpdateReportInput {
  data?: Record<string, any>;
  status?: string;
}

/**
 * QC reports: instances of drag-drop FormTemplates filled against a production
 * work order. Template name+schema are snapshotted at creation; the filled
 * values live in `data`. List rows are enriched (order number, project, item
 * mark) so the reports page reads in shop terms.
 */
@Injectable()
export class QualityReportsService {
  constructor(
    @InjectRepository(QualityReport) private readonly repo: Repository<QualityReport>,
    @InjectRepository(FormTemplate) private readonly templateRepo: Repository<FormTemplate>,
    @InjectRepository(ProductionOrder) private readonly orderRepo: Repository<ProductionOrder>,
    @InjectRepository(AssemblyNode) private readonly nodeRepo: Repository<AssemblyNode>,
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

    const year = new Date().getFullYear();
    const prefix = `QR-${year}-`;
    for (let attempt = 0; attempt < 5; attempt++) {
      const rows: { num: string }[] = await this.repo.query(
        `SELECT number AS num FROM quality_reports WHERE number LIKE $1 AND organization_id = $2 ORDER BY number DESC LIMIT 1`,
        [`${prefix}%`, org],
      );
      const base = rows?.[0]?.num ? parseInt(rows[0].num.slice(prefix.length), 10) || 0 : 0;
      try {
        return await this.repo.save(this.repo.create({
          number: `${prefix}${String(base + 1).padStart(4, '0')}`,
          templateId: template.id,
          templateName: template.name,
          templateSchema: template.schema ?? { components: [] },
          productionOrderId: order.id,
          projectId: order.projectId,
          assemblyNodeId: node?.id ?? null,
          data: null,
          status: QualityReportStatus.DRAFT,
          filledBy: this.userId,
          organizationId: org,
        }));
      } catch (e: any) {
        if (e?.code === '23505') continue;
        throw e;
      }
    }
    throw new BadRequestException('Could not allocate a unique report number');
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
    if (input.status !== undefined) {
      if (!Object.values(QualityReportStatus).includes(input.status as QualityReportStatus)) {
        throw new BadRequestException(`Invalid status '${input.status}'`);
      }
      r.status = input.status as QualityReportStatus;
      if (r.status === QualityReportStatus.SUBMITTED) {
        r.submittedAt = r.submittedAt ?? new Date();
        r.filledBy = this.userId ?? r.filledBy;
      }
    }
    return this.repo.save(r);
  }

  async remove(id: string): Promise<{ ok: true }> {
    const r = await this.repo.findOne({ where: { id, organizationId: this.org } });
    if (!r) throw new NotFoundException('Report not found');
    await this.repo.delete({ id, organizationId: this.org });
    return { ok: true };
  }

  /** Attach order number, project name and item mark with three batched lookups. */
  private async enrich(rows: QualityReport[]) {
    if (!rows.length) return [] as any[];
    const orderIds = [...new Set(rows.map((r) => r.productionOrderId))];
    const projectIds = [...new Set(rows.map((r) => r.projectId).filter((x): x is string => !!x))];
    const nodeIds = [...new Set(rows.map((r) => r.assemblyNodeId).filter((x): x is string => !!x))];

    const orders: { id: string; number: string; customer_name: string | null }[] = orderIds.length
      ? await this.repo.query(`SELECT id, number, customer_name FROM production_orders WHERE id = ANY($1)`, [orderIds])
      : [];
    const projects: { id: string; name: string }[] = projectIds.length
      ? await this.repo.query(`SELECT id, name FROM projects WHERE id = ANY($1)`, [projectIds])
      : [];
    const nodes: { id: string; mark: string | null; name: string | null }[] = nodeIds.length
      ? await this.repo.query(`SELECT id, mark, name FROM assembly_nodes WHERE id = ANY($1)`, [nodeIds])
      : [];

    const oById = new Map(orders.map((o) => [o.id, o]));
    const pById = new Map(projects.map((p) => [p.id, p.name]));
    const nById = new Map(nodes.map((n) => [n.id, n.mark || n.name || null]));

    return rows.map((r) => ({
      ...r,
      orderNumber: oById.get(r.productionOrderId)?.number ?? null,
      customerName: oById.get(r.productionOrderId)?.customer_name ?? null,
      projectName: r.projectId ? pById.get(r.projectId) ?? null : null,
      itemMark: r.assemblyNodeId ? nById.get(r.assemblyNodeId) ?? null : null,
    }));
  }
}
