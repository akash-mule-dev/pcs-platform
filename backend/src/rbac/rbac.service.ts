import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DeepPartial } from 'typeorm';
import { RolePermission } from './entities/role-permission.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { PERMISSIONS } from '../auth/permissions.config.js';
import { UpsertPermissionDto } from './dto/rbac.dto.js';

@Injectable()
export class RbacService {
  constructor(@InjectRepository(RolePermission) private readonly repo: Repository<RolePermission>) {}

  private get org(): string { return TenantContext.requireOrganizationId(); }

  list(): Promise<RolePermission[]> {
    return this.repo.find({ where: { organizationId: this.org } as any });
  }

  async upsert(dto: UpsertPermissionDto): Promise<RolePermission> {
    let row = await this.repo.findOne({
      where: { role: dto.role, feature: dto.feature, organizationId: this.org } as any,
    });
    if (row) {
      if (dto.canView !== undefined) row.canView = dto.canView;
      if (dto.canManage !== undefined) row.canManage = dto.canManage;
      return this.repo.save(row);
    }
    row = this.repo.create({
      role: dto.role,
      feature: dto.feature,
      canView: dto.canView ?? true,
      canManage: dto.canManage ?? false,
      organizationId: this.org,
    } as DeepPartial<RolePermission>);
    return this.repo.save(row);
  }

  async remove(id: string): Promise<void> {
    const row = await this.repo.findOne({ where: { id, organizationId: this.org } as any });
    if (!row) throw new NotFoundException('Permission not found');
    await this.repo.remove(row);
  }

  /** Effective permissions for a role = code defaults overlaid with this tenant's overrides. */
  async resolveForRole(role: string) {
    const resolved: Record<string, { view: boolean; manage: boolean }> = {};
    for (const [feature, perm] of Object.entries(PERMISSIONS)) {
      const view = (perm.view as string[]).includes(role);
      const manage = ((perm.manage ?? perm.view) as string[]).includes(role);
      resolved[feature] = { view, manage };
    }
    const overrides = await this.repo.find({ where: { role, organizationId: this.org } as any });
    for (const o of overrides) {
      resolved[o.feature] = { view: o.canView, manage: o.canManage };
    }
    return { role, permissions: resolved };
  }

  /**
   * Full permissions map (feature -> { view: roles[], manage: roles[] }) for the
   * current tenant: code defaults overlaid with this tenant's overrides. Resilient —
   * with no tenant in context it returns the static defaults unchanged, so the auth
   * permissions endpoint never fails for legacy / org-less tokens.
   */
  async resolveEffectivePermissions(): Promise<Record<string, { view: string[]; manage: string[] }>> {
    const result: Record<string, { view: string[]; manage: string[] }> = {};
    for (const [feature, perm] of Object.entries(PERMISSIONS)) {
      result[feature] = {
        view: [...(perm.view as string[])],
        manage: [...((perm.manage ?? perm.view) as string[])],
      };
    }
    const org = TenantContext.getOrganizationId();
    if (!org) return result;
    const overrides = await this.repo.find({ where: { organizationId: org } as any });
    for (const o of overrides) {
      const f = result[o.feature] ?? (result[o.feature] = { view: [], manage: [] });
      f.view = f.view.filter((r) => r !== o.role);
      if (o.canView) f.view.push(o.role);
      f.manage = f.manage.filter((r) => r !== o.role);
      if (o.canManage) f.manage.push(o.role);
    }
    return result;
  }
}
