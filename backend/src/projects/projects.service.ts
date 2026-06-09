import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
}
