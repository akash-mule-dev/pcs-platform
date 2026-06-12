import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Role } from '../auth/entities/role.entity.js';
import { RolePermissionGrant } from './entities/role-permission-grant.entity.js';
import { sanitizeGrants, SYSTEM_ROLE_PERMISSIONS, SystemRoleName } from './permission-catalog.js';

export interface ResolvedAccess {
  role: Role;
  /** Effective permission keys (may contain `*` / `feature.*` wildcards). */
  permissions: ReadonlySet<string>;
}

/** JWT-shaped principal (set by JwtStrategy.validate). */
export interface AuthenticatedPrincipal {
  id: string;
  roleId?: string | null;
  role?: string | null; // role NAME (legacy tokens / convenience)
  organizationId?: string | null;
}

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  access: ResolvedAccess;
  expiresAt: number;
}

/**
 * Resolves the effective permission set of a role, with a short in-process
 * cache so the PermissionsGuard doesn't hit the DB on every request.
 *
 * - System roles: permissions come from the code catalog (never the DB).
 * - Custom roles: permissions come from role_permission_grants.
 *
 * Role mutations must call invalidate(roleId) so changes apply within the TTL.
 */
@Injectable()
export class RolePermissionsResolver {
  private readonly logger = new Logger(RolePermissionsResolver.name);
  private readonly byId = new Map<string, CacheEntry>();
  private readonly byName = new Map<string, CacheEntry>();

  constructor(
    @InjectRepository(Role) private readonly roleRepo: Repository<Role>,
    @InjectRepository(RolePermissionGrant) private readonly grantRepo: Repository<RolePermissionGrant>,
  ) {}

  /** Effective access for an authenticated principal (JWT payload shape). */
  async resolveForUser(user: AuthenticatedPrincipal): Promise<ResolvedAccess> {
    if (user?.roleId) return this.resolveByRoleId(user.roleId);
    // Legacy tokens (issued before roleId was added) carry only the role name.
    if (user?.role) return this.resolveSystemByName(user.role);
    throw new ForbiddenException('Token carries no role — please sign in again');
  }

  async resolveByRoleId(roleId: string): Promise<ResolvedAccess> {
    const cached = this.byId.get(roleId);
    if (cached && cached.expiresAt > Date.now()) return cached.access;

    const role = await this.roleRepo.findOne({ where: { id: roleId } });
    if (!role) throw new ForbiddenException('Your role no longer exists — please sign in again');
    const access: ResolvedAccess = { role, permissions: await this.loadPermissions(role) };
    this.byId.set(roleId, { access, expiresAt: Date.now() + CACHE_TTL_MS });
    return access;
  }

  /** System-role lookup by name (org-less), for legacy tokens only. */
  async resolveSystemByName(name: string): Promise<ResolvedAccess> {
    const cached = this.byName.get(name);
    if (cached && cached.expiresAt > Date.now()) return cached.access;

    const role = await this.roleRepo.findOne({ where: { name, organizationId: IsNull() } });
    if (!role) throw new ForbiddenException('Your role no longer exists — please sign in again');
    const access: ResolvedAccess = { role, permissions: await this.loadPermissions(role) };
    this.byName.set(name, { access, expiresAt: Date.now() + CACHE_TTL_MS });
    return access;
  }

  private async loadPermissions(role: Role): Promise<ReadonlySet<string>> {
    if (role.isSystem) {
      const defaults = SYSTEM_ROLE_PERMISSIONS[role.name as SystemRoleName];
      if (defaults) return new Set(defaults);
      this.logger.warn(`System role "${role.name}" has no catalog defaults — treating as no access`);
      return new Set();
    }
    const grants = await this.grantRepo.find({ where: { roleId: role.id } });
    return new Set(sanitizeGrants(grants.map((g) => g.permission)));
  }

  /** Drop cached permissions after a role is changed or deleted. */
  invalidate(roleId: string): void {
    const entry = this.byId.get(roleId);
    if (entry) this.byName.delete(entry.access.role.name);
    this.byId.delete(roleId);
  }

  invalidateAll(): void {
    this.byId.clear();
    this.byName.clear();
  }
}
