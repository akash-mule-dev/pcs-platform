import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Project } from './project.entity.js';
import { AssemblyNode } from './assembly-node.entity.js';
import { TenantScopedService } from '../common/tenant/tenant-scoped.service.js';
import { TenantContext } from '../common/tenant/tenant-context.js';

@Injectable()
export class ProjectsService extends TenantScopedService<Project> {
  constructor(
    @InjectRepository(Project) repo: Repository<Project>,
    @InjectRepository(AssemblyNode) private readonly nodeRepo: Repository<AssemblyNode>,
  ) {
    super(repo);
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
