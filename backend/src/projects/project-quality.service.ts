import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AssemblyNode } from './assembly-node.entity.js';
import { QualityData } from '../quality-data/quality-data.entity.js';
import { Ncr, NcrStatus } from '../quality-ncr/entities/ncr.entity.js';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { QualityDataService } from '../quality-data/quality-data.service.js';
import { QualityNcrService } from '../quality-ncr/quality-ncr.service.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { RecordNodeQualityDto, RaiseNodeNcrDto } from './dto/node-quality.dto.js';

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
 * NCRs to the assembly node being inspected, so a worker can inspect a part /
 * assembly and raise an NCR in context. Reuses QualityDataService (auto-fail on
 * tolerance) and QualityNcrService (numbering, raisedBy). Tenant-scoped.
 */
@Injectable()
export class ProjectQualityService {
  constructor(
    @InjectRepository(AssemblyNode) private readonly nodeRepo: Repository<AssemblyNode>,
    @InjectRepository(QualityData) private readonly qdRepo: Repository<QualityData>,
    @InjectRepository(Ncr) private readonly ncrRepo: Repository<Ncr>,
    @InjectRepository(WorkOrder) private readonly woRepo: Repository<WorkOrder>,
    private readonly qualityData: QualityDataService,
    private readonly ncr: QualityNcrService,
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
    });
  }

  /** Raise an NCR pre-filled from the node (links node/project/work-order/quality record). */
  async raiseNodeNcr(projectId: string, nodeId: string, dto: RaiseNodeNcrDto): Promise<Ncr> {
    const node = await this.getNode(projectId, nodeId);
    const wo = await this.woRepo.findOne({ where: { assemblyNodeId: node.id, organizationId: this.org } });
    let severity = dto.severity;
    if (!severity && dto.qualityDataId) {
      const qd = await this.qdRepo.findOne({ where: { id: dto.qualityDataId, organizationId: this.org } });
      severity = qd?.severity ?? undefined;
    }
    const label = node.mark || node.name || 'item';
    return this.ncr.createNcr({
      title: dto.title || `${label} — quality non-conformance`,
      description: dto.description,
      severity,
      workOrderId: wo?.id ?? undefined,
      assemblyNodeId: node.id,
      projectId,
      qualityDataId: dto.qualityDataId,
      dataJson: {
        source: 'fabrication-qa',
        projectId,
        assemblyNodeId: node.id,
        mark: node.mark,
        meshName: this.meshKey(node),
        qualityDataId: dto.qualityDataId ?? null,
      },
    } as any);
  }

  /** Per-node quality status + open-NCR map for badges and the shipping gate. */
  async projectQualitySummary(
    projectId: string,
  ): Promise<{ nodes: Record<string, NodeQualitySummary>; totals: { inspected: number; failed: number; openNcr: number } }> {
    const org = this.org;
    const rows = await this.qdRepo.find({ where: { projectId, organizationId: org, isActive: true } });
    const ncrs = await this.ncrRepo.find({ where: { projectId, organizationId: org } });

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
      if (n.status === NcrStatus.CLOSED || n.status === NcrStatus.CANCELLED) continue;
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
