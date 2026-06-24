import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AssemblyNode } from './assembly-node.entity.js';
import { QualityData } from '../quality-data/quality-data.entity.js';
import { QualityReport } from '../quality-reports/quality-report.entity.js';
import { QualityDataService } from '../quality-data/quality-data.service.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { RecordNodeQualityDto } from './dto/node-quality.dto.js';

export interface NodeQualitySummary {
  status: 'pass' | 'warning' | 'fail' | null;
  pass: number;
  fail: number;
  warning: number;
  total: number;
  openNcr: number;
  lastInspectedAt: string | null;
}

/**
 * Fabrication-scoped quality: ties the existing model+mesh quality records and
 * NCR reports (NCR-type QC reports) to the assembly node being inspected, so a
 * worker can inspect a part / assembly in context. Reuses QualityDataService
 * (auto-fail on tolerance). Tenant-scoped. NCRs are raised through the normal
 * template-driven QC-report flow, not from here.
 */
@Injectable()
export class ProjectQualityService {
  constructor(
    @InjectRepository(AssemblyNode) private readonly nodeRepo: Repository<AssemblyNode>,
    @InjectRepository(QualityData) private readonly qdRepo: Repository<QualityData>,
    @InjectRepository(QualityReport) private readonly reportRepo: Repository<QualityReport>,
    private readonly qualityData: QualityDataService,
  ) {}

  private get org(): string {
    return TenantContext.requireOrganizationId();
  }

  private async getNode(projectId: string, nodeId: string): Promise<AssemblyNode> {
    const node = await this.nodeRepo.findOne({ where: { id: nodeId, projectId, organizationId: this.org } });
    if (!node) throw new NotFoundException('Assembly node not found');
    return node;
  }

  private meshKey(node: AssemblyNode): string {
    return node.meshName || node.ifcGuid || `node:${node.id}`;
  }

  /** A node's inspections — node-linked, plus legacy AR records matching its mesh on the same model. */
  async listNodeQuality(projectId: string, nodeId: string): Promise<QualityData[]> {
    const node = await this.getNode(projectId, nodeId);
    return this.qdRepo
      .createQueryBuilder('qd')
      .where('qd.is_active = :active', { active: true })
      .andWhere('qd.organization_id = :org', { org: this.org })
      .andWhere('(qd.assembly_node_id = :nodeId OR (qd.model_id = :modelId AND qd.mesh_name = :meshKey))', {
        nodeId,
        modelId: node.modelId ?? '00000000-0000-0000-0000-000000000000',
        meshKey: this.meshKey(node),
      })
      .orderBy('qd.created_at', 'DESC')
      .getMany();
  }

  /** Record a check on a node; reuses QualityDataService.create (auto-fails out-of-tolerance). */
  async recordNodeQuality(projectId: string, nodeId: string, dto: RecordNodeQualityDto): Promise<QualityData> {
    const node = await this.getNode(projectId, nodeId);
    if (!node.modelId) {
      throw new BadRequestException(
        'This item has no linked 3D model yet — quality records require one (the GLB may still be converting).',
      );
    }
    return this.qualityData.create({
      modelId: node.modelId,
      meshName: this.meshKey(node),
      regionLabel: dto.regionLabel ?? node.mark ?? node.name ?? undefined,
      status: dto.status,
      inspector: dto.inspector,
      inspectionDate: new Date().toISOString(),
      notes: dto.notes,
      defectType: dto.defectType,
      severity: dto.severity,
      measurementValue: dto.measurementValue,
      measurementUnit: dto.measurementUnit,
      toleranceMin: dto.toleranceMin,
      toleranceMax: dto.toleranceMax,
      assemblyNodeId: node.id,
      projectId,
      stageId: dto.stageId,
      workOrderStageId: dto.workOrderStageId,
    });
  }

  /** Per-node quality status + open-NCR map for badges and the shipping gate. */
  async projectQualitySummary(
    projectId: string,
  ): Promise<{ nodes: Record<string, NodeQualitySummary>; totals: { inspected: number; failed: number; openNcr: number } }> {
    const org = this.org;
    const rows = await this.qdRepo.find({ where: { projectId, organizationId: org, isActive: true } });
    const ncrs = await this.reportRepo.find({ where: { projectId, organizationId: org, templateType: 'ncr' } });

    const nodes: Record<string, NodeQualitySummary> = {};
    const ensure = (id: string): NodeQualitySummary =>
      (nodes[id] ||= { status: null, pass: 0, fail: 0, warning: 0, total: 0, openNcr: 0, lastInspectedAt: null });
    const rank: Record<string, number> = { pass: 0, warning: 1, fail: 2 };

    for (const r of rows) {
      if (!r.assemblyNodeId) continue;
      const e = ensure(r.assemblyNodeId);
      if (r.status === 'pass' || r.status === 'fail' || r.status === 'warning') {
        e[r.status]++;
        e.total++;
        if (e.status === null || rank[r.status] > rank[e.status]) e.status = r.status;
      }
      const at = r.inspectionDate ?? r.createdAt;
      const iso = at instanceof Date ? at.toISOString() : at ? String(at) : null;
      if (iso && (!e.lastInspectedAt || iso > e.lastInspectedAt)) e.lastInspectedAt = iso;
    }

    let openNcrTotal = 0;
    for (const n of ncrs) {
      if (n.resolvedAt) continue;
      openNcrTotal++;
      if (n.assemblyNodeId) ensure(n.assemblyNodeId).openNcr++;
    }

    const all = Object.values(nodes);
    return {
      nodes,
      totals: {
        inspected: all.filter((e) => e.total > 0).length,
        failed: all.filter((e) => e.status === 'fail').length,
        openNcr: openNcrTotal,
      },
    };
  }
}
