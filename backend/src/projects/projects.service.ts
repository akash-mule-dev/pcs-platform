import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Project } from './project.entity.js';
import { AssemblyNode } from './assembly-node.entity.js';
import { TenantScopedService } from '../common/tenant/tenant-scoped.service.js';
import { TenantContext } from '../common/tenant/tenant-context.js';

/** Per-project rollup the portfolio list renders without N progress calls. */
export interface ProjectMetrics {
  nodeCount: number;
  partCount: number;
  assemblyCount: number;
  percentComplete: number;
  tonnage: { totalKg: number; processedKg: number; shippedKg: number };
  readyToShip: number;
  inProgress: number;
}
export type ProjectWithMetrics = Project & { metrics: ProjectMetrics };

const EMPTY_METRICS: ProjectMetrics = {
  nodeCount: 0, partCount: 0, assemblyCount: 0, percentComplete: 0,
  tonnage: { totalKg: 0, processedKg: 0, shippedKg: 0 }, readyToShip: 0, inProgress: 0,
};

@Injectable()
export class ProjectsService extends TenantScopedService<Project> {
  constructor(
    @InjectRepository(Project) repo: Repository<Project>,
    @InjectRepository(AssemblyNode) private readonly nodeRepo: Repository<AssemblyNode>,
  ) {
    super(repo);
  }

  /**
   * Portfolio list: every project plus its production rollup (progress, tonnage,
   * ready-to-ship), computed in ONE grouped pass over assembly_nodes rather than
   * a per-project progress call. The weight-weighted percent mirrors
   * progress-math: weighted by part tonnage when weights exist, else the average
   * assembly percent.
   */
  async findAllWithMetrics(): Promise<ProjectWithMetrics[]> {
    const organizationId = this.organizationId;
    const projects = await this.repo.find({
      where: { organizationId } as any,
      order: { createdAt: 'DESC' } as any,
    });
    if (!projects.length) return [];

    const rows = await this.nodeRepo
      .createQueryBuilder('n')
      .select('n.project_id', 'projectId')
      .addSelect('COUNT(*)', 'nodeCount')
      .addSelect(`SUM(CASE WHEN n.node_type = 'part' THEN 1 ELSE 0 END)`, 'partCount')
      .addSelect(`SUM(CASE WHEN n.node_type IN ('assembly','subassembly') THEN 1 ELSE 0 END)`, 'assemblyCount')
      .addSelect(`COALESCE(SUM(CASE WHEN n.node_type = 'part' THEN n.weight_kg * n.quantity ELSE 0 END), 0)`, 'totalKg')
      .addSelect(`COALESCE(SUM(CASE WHEN n.node_type = 'part' THEN n.weight_kg * n.quantity * n.percent_complete / 100 ELSE 0 END), 0)`, 'processedKg')
      .addSelect(`COALESCE(SUM(CASE WHEN n.node_type = 'part' AND n.production_status = 'shipped' THEN n.weight_kg * n.quantity ELSE 0 END), 0)`, 'shippedKg')
      .addSelect(`COALESCE(SUM(CASE WHEN n.node_type IN ('assembly','subassembly') THEN n.percent_complete ELSE 0 END), 0)`, 'fabPctSum')
      .addSelect(`SUM(CASE WHEN n.node_type IN ('assembly','subassembly') AND n.production_status = 'ready_to_ship' THEN 1 ELSE 0 END)`, 'readyToShip')
      .addSelect(`SUM(CASE WHEN n.node_type IN ('assembly','subassembly') AND n.production_status = 'in_progress' THEN 1 ELSE 0 END)`, 'inProgress')
      .where('n.organization_id = :organizationId', { organizationId })
      .groupBy('n.project_id')
      .getRawMany<{
        projectId: string; nodeCount: string; partCount: string; assemblyCount: string;
        totalKg: string; processedKg: string; shippedKg: string; fabPctSum: string;
        readyToShip: string; inProgress: string;
      }>();

    const byProject = new Map<string, ProjectMetrics>();
    for (const r of rows) {
      const totalKg = Number(r.totalKg) || 0;
      const processedKg = Number(r.processedKg) || 0;
      const assemblyCount = Number(r.assemblyCount) || 0;
      const fabPctSum = Number(r.fabPctSum) || 0;
      const percentComplete = totalKg > 0
        ? Math.round((processedKg / totalKg) * 1000) / 10
        : assemblyCount > 0 ? Math.round((fabPctSum / assemblyCount) * 10) / 10 : 0;
      byProject.set(r.projectId, {
        nodeCount: Number(r.nodeCount) || 0,
        partCount: Number(r.partCount) || 0,
        assemblyCount,
        percentComplete,
        tonnage: {
          totalKg: Math.round(totalKg * 10) / 10,
          processedKg: Math.round(processedKg * 10) / 10,
          shippedKg: Math.round((Number(r.shippedKg) || 0) * 10) / 10,
        },
        readyToShip: Number(r.readyToShip) || 0,
        inProgress: Number(r.inProgress) || 0,
      });
    }

    return projects.map((p) => Object.assign(p, { metrics: byProject.get(p.id) ?? { ...EMPTY_METRICS } }));
  }

  /**
   * Flat, tenant-scoped list of a project's assembly nodes, ordered so the
   * client can render the tree directly (depth, then sibling order).
   */
  async findNodes(projectId: string): Promise<AssemblyNode[]> {
    await this.findOne(projectId); // ensures the project exists within this tenant
    return this.nodeRepo.find({
      where: { projectId, organizationId: TenantContext.requireOrganizationId() },
      order: { depth: 'ASC', sortIndex: 'ASC' },
    });
  }

  /** One assembly node with full detail (dimensions, properties, model link). */
  async findNode(projectId: string, nodeId: string): Promise<AssemblyNode> {
    const organizationId = TenantContext.requireOrganizationId();
    const node = await this.nodeRepo.findOne({ where: { id: nodeId, projectId, organizationId } });
    if (!node) throw new NotFoundException('Assembly node not found');
    return node;
  }

  /**
   * GLB mesh names to isolate for a node: its own mesh plus every descendant's
   * (assembly/subassembly containers have no geometry — their parts do), so a
   * part isolates to itself and an assembly isolates to all its pieces.
   */
  async nodeMeshNames(projectId: string, nodeId: string): Promise<string[]> {
    const organizationId = TenantContext.requireOrganizationId();
    const node = await this.nodeRepo.findOne({ where: { id: nodeId, projectId, organizationId } });
    if (!node) throw new NotFoundException('Assembly node not found');
    const names = new Set<string>();
    const own = node.meshName || node.ifcGuid;
    if (own) names.add(own);
    let frontier = [nodeId];
    while (frontier.length) {
      const kids = await this.nodeRepo.find({ where: { organizationId, projectId, parentId: In(frontier) } });
      if (!kids.length) break;
      for (const k of kids) { const m = k.meshName || k.ifcGuid; if (m) names.add(m); }
      frontier = kids.map((k) => k.id);
    }
    return [...names];
  }
}
