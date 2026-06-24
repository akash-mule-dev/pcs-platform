import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { Project } from './project.entity.js';
import { AssemblyNode } from './assembly-node.entity.js';
import { TenantScopedService } from '../common/tenant/tenant-scoped.service.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { ProjectPurgeService, PROJECT_RETENTION_DAYS } from './project-purge.service.js';

/** Per-project design summary the portfolio list renders without N progress calls. */
export interface ProjectMetrics {
  nodeCount: number;
  partCount: number;
  assemblyCount: number;
  tonnage: { totalKg: number };
}
export type ProjectWithMetrics = Project & { metrics: ProjectMetrics };

/** A soft-deleted project in the Trash, with its countdown to permanent purge. */
export type DeletedProject = Project & { purgeAt: string; daysRemaining: number };

const EMPTY_METRICS: ProjectMetrics = {
  nodeCount: 0, partCount: 0, assemblyCount: 0, tonnage: { totalKg: 0 },
};

const RETENTION_MS = PROJECT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

@Injectable()
export class ProjectsService extends TenantScopedService<Project> {
  constructor(
    @InjectRepository(Project) repo: Repository<Project>,
    @InjectRepository(AssemblyNode) private readonly nodeRepo: Repository<AssemblyNode>,
    private readonly purgeService: ProjectPurgeService,
  ) {
    super(repo);
  }

  /**
   * Soft-delete: move the project to the Trash (stamp `deleted_at`). It vanishes
   * from every list/read (TypeORM auto-excludes soft-deleted rows) but stays
   * recoverable for the retention window before the scheduled purge removes it
   * for good. Overrides the base hard delete.
   */
  override async remove(id: string): Promise<void> {
    await this.findOne(id); // org-scoped existence check (404 if missing / already trashed)
    await this.repo.softDelete(id);
  }

  /** Restore a project from the Trash (clear `deleted_at`). */
  async restore(id: string): Promise<Project> {
    const found = await this.repo.findOne({
      where: { id, organizationId: this.organizationId } as any,
      withDeleted: true,
    });
    if (!found) throw new NotFoundException('Resource not found');
    await this.repo.restore(id);
    return this.findOne(id);
  }

  /** The Trash: soft-deleted projects (this org), newest first, with a purge countdown. */
  async listDeleted(): Promise<DeletedProject[]> {
    const projects = await this.repo.find({
      where: { organizationId: this.organizationId, deletedAt: Not(IsNull()) } as any,
      withDeleted: true,
      order: { deletedAt: 'DESC' } as any,
    });
    const now = Date.now();
    return projects.map((proj) => {
      const purgeMs = (proj.deletedAt ? proj.deletedAt.getTime() : now) + RETENTION_MS;
      // Cap at the retention max so tiny DB/app clock skew never reads "31 days".
      const daysRemaining = Math.min(
        PROJECT_RETENTION_DAYS,
        Math.max(0, Math.ceil((purgeMs - now) / (24 * 60 * 60 * 1000))),
      );
      return Object.assign(proj, { purgeAt: new Date(purgeMs).toISOString(), daysRemaining });
    });
  }

  /**
   * Permanently delete a project NOW (skip the retention wait) — the "Delete
   * permanently" action in the Trash. Org-scoped existence check, then hand off
   * to the cascade purge (whole subtree + blobs).
   */
  async purge(id: string): Promise<void> {
    const found = await this.repo.findOne({
      where: { id, organizationId: this.organizationId } as any,
      withDeleted: true,
    });
    if (!found) throw new NotFoundException('Resource not found');
    await this.purgeService.hardDelete(id);
  }

  /**
   * Portfolio list: every project plus its design summary (composition, tonnage),
   * computed in ONE grouped pass over assembly_nodes rather than a per-project
   * progress call. Production tracking lives on each production order.
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
      .where('n.organization_id = :organizationId', { organizationId })
      .groupBy('n.project_id')
      .getRawMany<{ projectId: string; nodeCount: string; partCount: string; assemblyCount: string; totalKg: string }>();

    const byProject = new Map<string, ProjectMetrics>();
    for (const r of rows) {
      byProject.set(r.projectId, {
        nodeCount: Number(r.nodeCount) || 0,
        partCount: Number(r.partCount) || 0,
        assemblyCount: Number(r.assemblyCount) || 0,
        tonnage: { totalKg: Math.round((Number(r.totalKg) || 0) * 10) / 10 },
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
