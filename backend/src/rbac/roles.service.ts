import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { Role } from '../auth/entities/role.entity.js';
import { User } from '../auth/entities/user.entity.js';
import { RolePermissionGrant } from './entities/role-permission-grant.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { AuditService } from '../audit/audit.service.js';
import { CreateRoleDto, DuplicateRoleDto, UpdateRoleDto } from './dto/role.dto.js';
import {
  ALL_PERMISSION_KEYS,
  expandGrants,
  isKnownPermission,
  isPlatformPermission,
  PERMISSION_CATALOG,
  PERMISSION_CATEGORIES,
  PLATFORM_ADMIN_ROLE_NAME,
  SYSTEM_ROLE_PERMISSIONS,
  SystemRoleName,
  WILDCARD,
} from './permission-catalog.js';
import { RolePermissionsResolver } from './role-permissions.resolver.js';

export interface RoleView {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  organizationId: string | null;
  permissions: string[];
  userCount: number;
  createdAt: Date;
}

/**
 * Role management: built-in system roles (read-only, shared) + per-organization
 * custom roles with fine-grained permission grants. All reads/writes are scoped
 * to the caller's organization.
 */
@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Role) private readonly roleRepo: Repository<Role>,
    @InjectRepository(RolePermissionGrant) private readonly grantRepo: Repository<RolePermissionGrant>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly resolver: RolePermissionsResolver,
    private readonly audit: AuditService,
  ) {}

  private get org(): string | null {
    return TenantContext.getOrganizationId();
  }

  /** Org-scoped writes need a tenant — fail with a clean 400, not a 500. */
  private requireOrg(): string {
    const org = this.org;
    if (!org) {
      throw new BadRequestException(
        'Custom roles belong to an organization, but your session has none — sign out and back in (or have your account assigned to an organization).',
      );
    }
    return org;
  }

  /** The permission catalog (for the role-editor matrix UIs). */
  catalog() {
    return {
      categories: PERMISSION_CATEGORIES,
      features: PERMISSION_CATALOG,
      systemRolePermissions: SYSTEM_ROLE_PERMISSIONS,
      wildcard: WILDCARD,
    };
  }

  /** System roles + this organization's custom roles, with permissions and user counts. */
  async list(): Promise<RoleView[]> {
    const roles = await this.visibleRoles();
    if (!roles.length) return [];
    const [grantsByRole, countsByRole] = await Promise.all([
      this.grantsByRole(roles),
      this.userCounts(roles),
    ]);
    return roles
      .map((r) => this.toView(r, grantsByRole, countsByRole))
      .sort((a, b) => Number(b.isSystem) - Number(a.isSystem) || a.name.localeCompare(b.name));
  }

  /** Lightweight list for role-assignment dropdowns. */
  async assignable(): Promise<Array<Pick<RoleView, 'id' | 'name' | 'isSystem' | 'description'>>> {
    const roles = await this.visibleRoles();
    return roles
      .sort((a, b) => Number(b.isSystem) - Number(a.isSystem) || a.name.localeCompare(b.name))
      .map((r) => ({ id: r.id, name: r.name, isSystem: r.isSystem, description: r.description ?? null }));
  }

  async get(id: string): Promise<RoleView> {
    const role = await this.findVisible(id);
    const [grantsByRole, countsByRole] = await Promise.all([
      this.grantsByRole([role]),
      this.userCounts([role]),
    ]);
    return this.toView(role, grantsByRole, countsByRole);
  }

  async create(dto: CreateRoleDto): Promise<RoleView> {
    const org = this.requireOrg();
    const permissions = this.validatePermissions(dto.permissions);
    await this.assertNameAvailable(dto.name, org);

    const saved = await this.dataSource.transaction(async (em) => {
      const role = await em.getRepository(Role).save(
        em.getRepository(Role).create({
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          organizationId: org,
          isSystem: false,
        }),
      );
      await em.getRepository(RolePermissionGrant).save(
        permissions.map((permission) => em.getRepository(RolePermissionGrant).create({ roleId: role.id, permission })),
      );
      return role;
    });
    await this.audit.log({
      userId: TenantContext.get()?.userId ?? null,
      action: 'create',
      entityType: 'role',
      entityId: saved.id,
      newValues: { name: saved.name, organizationId: org, permissions },
    });
    return this.get(saved.id);
  }

  async update(id: string, dto: UpdateRoleDto): Promise<RoleView> {
    const role = await this.findVisible(id);
    this.assertCustom(role, 'edited');

    const oldName = role.name;
    if (dto.name && dto.name.trim() !== role.name) {
      await this.assertNameAvailable(dto.name, role.organizationId!);
      role.name = dto.name.trim();
    }
    if (dto.description !== undefined) role.description = dto.description?.trim() || null;

    const permissions = dto.permissions !== undefined ? this.validatePermissions(dto.permissions) : null;
    const oldPermissions = permissions
      ? (await this.grantRepo.find({ where: { roleId: role.id } })).map((g) => g.permission).sort()
      : null;

    await this.dataSource.transaction(async (em) => {
      await em.getRepository(Role).save(role);
      if (permissions) {
        const grantRepo = em.getRepository(RolePermissionGrant);
        const existing = await grantRepo.find({ where: { roleId: role.id } });
        const wanted = new Set(permissions);
        const toRemove = existing.filter((g) => !wanted.has(g.permission));
        const have = new Set(existing.map((g) => g.permission));
        const toAdd = permissions.filter((p) => !have.has(p));
        if (toRemove.length) await grantRepo.remove(toRemove);
        if (toAdd.length) await grantRepo.save(toAdd.map((permission) => grantRepo.create({ roleId: role.id, permission })));
      }
    });

    this.resolver.invalidate(role.id);
    await this.audit.log({
      userId: TenantContext.get()?.userId ?? null,
      action: 'update',
      entityType: 'role',
      entityId: role.id,
      oldValues: { name: oldName, ...(oldPermissions ? { permissions: oldPermissions } : {}) },
      newValues: { name: role.name, ...(permissions ? { permissions: [...permissions].sort() } : {}) },
    });
    return this.get(role.id);
  }

  async remove(id: string): Promise<void> {
    const role = await this.findVisible(id);
    this.assertCustom(role, 'deleted');
    const assigned = await this.userRepo.count({ where: { roleId: role.id } });
    if (assigned > 0) {
      throw new ConflictException(
        `Cannot delete "${role.name}" — ${assigned} user${assigned > 1 ? 's are' : ' is'} assigned to it. Reassign them first.`,
      );
    }
    await this.roleRepo.remove(role); // grants cascade
    this.resolver.invalidate(id);
    await this.audit.log({
      userId: TenantContext.get()?.userId ?? null,
      action: 'delete',
      entityType: 'role',
      entityId: id,
      oldValues: { name: role.name, organizationId: role.organizationId },
    });
  }

  /** Clone any visible role (incl. system roles) into an editable custom role. */
  async duplicate(id: string, dto: DuplicateRoleDto): Promise<RoleView> {
    const source = await this.findVisible(id);
    const org = this.requireOrg();
    await this.assertNameAvailable(dto.name, org);

    let permissions: string[];
    if (source.isSystem) {
      permissions = expandGrants(SYSTEM_ROLE_PERMISSIONS[source.name as SystemRoleName] ?? []);
    } else {
      const grants = await this.grantRepo.find({ where: { roleId: source.id } });
      permissions = expandGrants(grants.map((g) => g.permission));
    }
    // Duplicates are tenant custom roles — platform permissions never carry over.
    permissions = permissions.filter((p) => !isPlatformPermission(p));
    if (!permissions.length) throw new BadRequestException('Source role has no permissions to copy');

    return this.create({
      name: dto.name,
      description: dto.description ?? (source.description ? `${source.description} (copy)` : `Copy of ${source.name}`),
      permissions,
    });
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async visibleRoles(): Promise<Role[]> {
    const org = this.org;
    const roles = await this.roleRepo.find({
      where: org ? [{ organizationId: IsNull(), isSystem: true }, { organizationId: org }] : [{ organizationId: IsNull(), isSystem: true }],
    });
    // The platform operator role is invisible inside tenant sessions — tenant
    // admins can neither see nor assign it.
    return org ? roles.filter((r) => !(r.isSystem && r.name === PLATFORM_ADMIN_ROLE_NAME)) : roles;
  }

  private async findVisible(id: string): Promise<Role> {
    const role = await this.roleRepo.findOne({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');
    const org = this.org;
    const visible = (role.isSystem && role.organizationId === null) || (org !== null && role.organizationId === org);
    if (!visible) throw new NotFoundException('Role not found');
    return role;
  }

  private assertCustom(role: Role, verb: string): void {
    if (role.isSystem) {
      throw new ForbiddenException(`System role "${role.name}" cannot be ${verb} — duplicate it to customize`);
    }
  }

  private validatePermissions(permissions: string[]): string[] {
    const unique = [...new Set(permissions.map((p) => p.trim()))].filter(Boolean);
    if (!unique.length) throw new BadRequestException('A role needs at least one permission');
    const unknown = unique.filter((p) => !isKnownPermission(p));
    if (unknown.length) {
      // Wildcards are reserved for system roles — custom roles enumerate access explicitly.
      throw new BadRequestException(`Unknown permission${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`);
    }
    const platform = unique.filter((p) => isPlatformPermission(p));
    if (platform.length) {
      throw new BadRequestException(
        `Platform permission${platform.length > 1 ? 's' : ''} cannot be granted to custom roles: ${platform.join(', ')}`,
      );
    }
    if (unique.length > ALL_PERMISSION_KEYS.length) throw new BadRequestException('Too many permissions');
    return unique;
  }

  private async assertNameAvailable(rawName: string, org: string): Promise<void> {
    const name = rawName.trim();
    const clash = await this.roleRepo
      .createQueryBuilder('role')
      .where('LOWER(role.name) = LOWER(:name)', { name })
      .andWhere('(role.organization_id IS NULL OR role.organization_id = :org)', { org })
      .getOne();
    if (clash) {
      throw new ConflictException(
        clash.isSystem ? `"${name}" is a built-in role name` : `A role named "${name}" already exists`,
      );
    }
  }

  private async grantsByRole(roles: Role[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    for (const r of roles) {
      if (r.isSystem) map.set(r.id, [...(SYSTEM_ROLE_PERMISSIONS[r.name as SystemRoleName] ?? [])]);
    }
    const customIds = roles.filter((r) => !r.isSystem).map((r) => r.id);
    if (customIds.length) {
      const grants = await this.grantRepo.find({ where: { roleId: In(customIds) } });
      for (const g of grants) {
        const list = map.get(g.roleId) ?? [];
        list.push(g.permission);
        map.set(g.roleId, list);
      }
      for (const id of customIds) if (!map.has(id)) map.set(id, []);
    }
    return map;
  }

  private async userCounts(roles: Role[]): Promise<Map<string, number>> {
    const ids = roles.map((r) => r.id);
    const rows: Array<{ role_id: string; count: string }> = await this.userRepo
      .createQueryBuilder('user')
      .select('user.role_id', 'role_id')
      .addSelect('COUNT(*)', 'count')
      .where('user.role_id IN (:...ids)', { ids })
      .andWhere('user.is_active = true')
      .groupBy('user.role_id')
      .getRawMany();
    const map = new Map<string, number>();
    for (const row of rows) map.set(row.role_id, Number(row.count));
    return map;
  }

  private toView(role: Role, grants: Map<string, string[]>, counts: Map<string, number>): RoleView {
    return {
      id: role.id,
      name: role.name,
      description: role.description ?? null,
      isSystem: role.isSystem,
      organizationId: role.organizationId,
      permissions: (grants.get(role.id) ?? []).sort(),
      userCount: counts.get(role.id) ?? 0,
      createdAt: role.createdAt,
    };
  }
}
