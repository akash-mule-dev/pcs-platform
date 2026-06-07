import { NotFoundException } from '@nestjs/common';
import { Repository, ObjectLiteral, DeepPartial } from 'typeorm';
import { TenantContext } from './tenant-context.js';

/**
 * Base service for tenant-owned entities. Every read is filtered by the current
 * organization and every create stamps it, so isolation doesn't depend on each
 * call site remembering a WHERE. Entities must extend TenantOwnedEntity and have
 * an `id` column.
 *
 * This is the reusable scoping pattern for the whole platform — new modules
 * extend it, and existing modules are migrated onto it module-by-module.
 */
export abstract class TenantScopedService<T extends ObjectLiteral> {
  protected constructor(protected readonly repo: Repository<T>) {}

  protected get organizationId(): string {
    return TenantContext.requireOrganizationId();
  }

  async findAll(extraWhere: Record<string, any> = {}): Promise<T[]> {
    return this.repo.find({
      where: { ...extraWhere, organizationId: this.organizationId } as any,
    });
  }

  async findOne(id: string): Promise<T> {
    const found = await this.repo.findOne({
      where: { id, organizationId: this.organizationId } as any,
    });
    if (!found) throw new NotFoundException('Resource not found');
    return found;
  }

  async create(data: DeepPartial<T>): Promise<T> {
    const entity = this.repo.create({
      ...(data as any),
      organizationId: this.organizationId,
    });
    return this.repo.save(entity as any);
  }

  async update(id: string, data: DeepPartial<T>): Promise<T> {
    const entity = await this.findOne(id);
    Object.assign(entity as any, data);
    return this.repo.save(entity as any);
  }

  async remove(id: string): Promise<void> {
    const entity = await this.findOne(id);
    await this.repo.remove(entity);
  }
}
