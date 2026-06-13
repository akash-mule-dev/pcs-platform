import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../auth/entities/user.entity.js';
import { Role } from '../auth/entities/role.entity.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { PageOptionsDto, PageDto, PageMetaDto } from '../common/dto/pagination.dto.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { RolePermissionsResolver } from '../rbac/role-permissions.resolver.js';
import { hasPermission, PLATFORM_ADMIN_ROLE_NAME } from '../rbac/permission-catalog.js';
import { AuditService } from '../audit/audit.service.js';

/**
 * User management, tenant-scoped: an organization's admins only ever see and
 * manage their own organization's users (legacy org-less rows stay visible
 * during rollout). Org-less platform operators see and manage everything.
 *
 * Safety rails (industry standard):
 *  - assigned roles must be a system role or a custom role of the SAME org
 *  - the platform-admin role is only assignable by platform operators, and
 *    platform accounts are invisible/immutable inside tenant sessions
 *  - tenant callers cannot provision users into other organizations
 *  - you cannot deactivate yourself or change your own role
 *  - deactivating the organization's last admin-equivalent user is blocked
 *  - every mutation is written to the audit log
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
    private readonly permissionsResolver: RolePermissionsResolver,
    private readonly audit: AuditService,
  ) {}

  private get org(): string | null {
    return TenantContext.getOrganizationId();
  }

  private get currentUserId(): string | null {
    return TenantContext.get()?.userId ?? null;
  }

  private stripPassword(user: User): User {
    const { passwordHash, ...safe } = user as any;
    return safe as User;
  }

  async findAll(pageOptions: PageOptionsDto, roleFilter?: string, status?: string): Promise<PageDto<User>> {
    const qb = this.userRepo.createQueryBuilder('user')
      .leftJoinAndSelect('user.role', 'role')
      .orderBy('user.createdAt', pageOptions.order)
      .skip(pageOptions.skip)
      .take(pageOptions.limit);

    const org = this.org;
    if (org) {
      qb.andWhere('(user.organizationId = :org OR user.organizationId IS NULL)', { org });
      // Platform operator accounts never appear inside tenant sessions.
      qb.andWhere('NOT (role.isSystem = true AND role.name = :platformRole)', {
        platformRole: PLATFORM_ADMIN_ROLE_NAME,
      });
    }

    if (status === 'inactive') {
      qb.andWhere('user.isActive = :isActive', { isActive: false });
    } else if (status !== 'all') {
      qb.andWhere('user.isActive = :isActive', { isActive: true });
    }

    if (roleFilter) {
      // Accept a role id (uuid) or a role name.
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roleFilter)) {
        qb.andWhere('user.roleId = :roleId', { roleId: roleFilter });
      } else {
        qb.andWhere('role.name = :role', { role: roleFilter });
      }
    }

    const [items, count] = await qb.getManyAndCount();
    const meta = new PageMetaDto(pageOptions, count);
    return new PageDto(items.map(u => this.stripPassword(u)), meta);
  }

  async findOne(id: string): Promise<User> {
    const user = await this.findOneWithHash(id);
    return this.stripPassword(user);
  }

  private async findOneWithHash(id: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id }, relations: ['role'] });
    if (!user) throw new NotFoundException('User not found');
    const org = this.org;
    if (org && user.organizationId && user.organizationId !== org) {
      // Cross-tenant ids must be indistinguishable from missing ones.
      throw new NotFoundException('User not found');
    }
    if (org && user.organizationId === null && user.role?.isSystem && user.role.name === PLATFORM_ADMIN_ROLE_NAME) {
      // Platform operator accounts are invisible inside tenant sessions.
      throw new NotFoundException('User not found');
    }
    return user;
  }

  /**
   * Stricter scope for WRITES: tenant callers may only mutate users of their
   * own organization — org-less accounts (platform operators / unprovisioned
   * legacy users) are off-limits and must be managed by a platform operator.
   */
  private async findOneForMutation(id: string): Promise<User> {
    const user = await this.findOneWithHash(id);
    const org = this.org;
    if (org && user.organizationId !== org) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async create(dto: CreateUserDto): Promise<User> {
    const conditions: any[] = [{ employeeId: dto.employeeId }];
    if (dto.email) conditions.push({ email: dto.email });
    const exists = await this.userRepo.findOne({ where: conditions });
    if (exists) throw new ConflictException('User with this email or employee ID already exists');

    // Tenant callers provision into their own org only; org-less platform
    // operators may provision into any organization (explicit org wins).
    const callerOrg = this.org;
    if (callerOrg && dto.organizationId && dto.organizationId !== callerOrg) {
      throw new ForbiddenException('You cannot create users in another organization');
    }
    const organizationId = dto.organizationId ?? callerOrg ?? null;
    await this.assertRoleAssignable(dto.roleId, organizationId);

    const hash = await bcrypt.hash(dto.password, 10);
    const user = this.userRepo.create({
      employeeId: dto.employeeId,
      email: dto.email || null,
      mobileNo: dto.mobileNo,
      passwordHash: hash,
      firstName: dto.firstName,
      lastName: dto.lastName,
      roleId: dto.roleId,
      organizationId,
    });
    const saved = await this.userRepo.save(user);
    await this.audit.log({
      userId: this.currentUserId,
      action: 'create',
      entityType: 'user',
      entityId: saved.id,
      newValues: { employeeId: saved.employeeId, email: saved.email, roleId: saved.roleId, organizationId },
    });
    return this.findOne(saved.id);
  }

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.findOneForMutation(id);
    const self = this.currentUserId !== null && this.currentUserId === id;
    const oldValues: Record<string, any> = {};
    const newValues: Record<string, any> = {};

    if (dto.roleId !== undefined && dto.roleId !== user.roleId) {
      if (self) throw new ForbiddenException('You cannot change your own role');
      await this.assertRoleAssignable(dto.roleId, user.organizationId);
      await this.assertNotLastAdmin(user, 'change the role of');
      oldValues['roleId'] = user.roleId;
      newValues['roleId'] = dto.roleId;
      user.roleId = dto.roleId;
      // The eagerly-loaded relation still points at the OLD role and would win
      // over the FK column on save — drop it so the new roleId persists.
      (user as { role?: unknown }).role = undefined;
    }
    if (dto.isActive !== undefined && dto.isActive !== user.isActive) {
      if (self && dto.isActive === false) throw new ForbiddenException('You cannot deactivate your own account');
      if (dto.isActive === false) await this.assertNotLastAdmin(user, 'deactivate');
      oldValues['isActive'] = user.isActive;
      newValues['isActive'] = dto.isActive;
      user.isActive = dto.isActive;
    }
    if (dto.password) {
      user.passwordHash = await bcrypt.hash(dto.password, 10);
      newValues['password'] = '(changed)';
    }
    if (dto.email !== undefined) user.email = dto.email;
    if (dto.mobileNo !== undefined) user.mobileNo = dto.mobileNo;
    if (dto.firstName !== undefined) user.firstName = dto.firstName;
    if (dto.lastName !== undefined) user.lastName = dto.lastName;
    if (dto.hourlyRate !== undefined && Number(dto.hourlyRate) !== Number(user.hourlyRate ?? 0)) {
      oldValues['hourlyRate'] = user.hourlyRate;
      newValues['hourlyRate'] = dto.hourlyRate;
      user.hourlyRate = dto.hourlyRate;
    }
    await this.userRepo.save(user);
    await this.audit.log({
      userId: this.currentUserId,
      action: newValues['roleId'] ? 'role_change' : 'update',
      entityType: 'user',
      entityId: id,
      oldValues: Object.keys(oldValues).length ? oldValues : null,
      newValues: Object.keys(newValues).length ? newValues : null,
    });
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    if (this.currentUserId === id) {
      throw new ForbiddenException('You cannot deactivate your own account');
    }
    const user = await this.findOneForMutation(id);
    await this.assertNotLastAdmin(user, 'deactivate');
    user.isActive = false;
    await this.userRepo.save(user);
    await this.audit.log({
      userId: this.currentUserId,
      action: 'deactivate',
      entityType: 'user',
      entityId: id,
      oldValues: { isActive: true },
      newValues: { isActive: false },
    });
  }

  // ── safety rails ───────────────────────────────────────────────────────────

  /**
   * Assigned role must exist and be a system role or a custom role of the
   * user's org. The platform-admin role is the exception: only callers who
   * already hold platform permissions may grant it (no self-escalation path
   * for tenant admins).
   */
  private async assertRoleAssignable(roleId: string, organizationId: string | null): Promise<void> {
    const role = await this.roleRepo.findOne({ where: { id: roleId } });
    if (!role) throw new BadRequestException('Role does not exist');
    if (role.organizationId === null) {
      if (!role.isSystem) throw new BadRequestException('Role is not assignable');
      if (role.name === PLATFORM_ADMIN_ROLE_NAME) {
        const caller = await this.callerPermissions();
        if (!caller || !hasPermission(caller, 'organizations.manage')) {
          throw new ForbiddenException('Only platform operators can assign the platform-admin role');
        }
      }
      return;
    }
    if (!organizationId || role.organizationId !== organizationId) {
      throw new BadRequestException('Role belongs to a different organization');
    }
  }

  /** The CALLER's effective permission set (null when unresolvable). */
  private async callerPermissions(): Promise<ReadonlySet<string> | null> {
    const callerId = this.currentUserId;
    if (!callerId) return null;
    const caller = await this.userRepo.findOne({ where: { id: callerId } });
    if (!caller) return null;
    try {
      const access = await this.permissionsResolver.resolveByRoleId(caller.roleId);
      return access.permissions;
    } catch {
      return null;
    }
  }

  /**
   * Block deactivating / demoting the last active user who can still manage
   * users & roles in this organization — otherwise the tenant locks itself out.
   */
  private async assertNotLastAdmin(user: User, verb: string): Promise<void> {
    const access = await this.permissionsResolver.resolveByRoleId(user.roleId);
    const { permissions } = access;
    const isAdminEquivalent =
      permissions.has('*') ||
      (permissions.has('users.update') && (permissions.has('roles.update') || permissions.has('roles.view')));
    if (!isAdminEquivalent) return;

    const qb = this.userRepo.createQueryBuilder('user')
      .innerJoin('user.role', 'role')
      .where('user.isActive = true')
      .andWhere('user.id != :id', { id: user.id })
      .andWhere(`(role.isSystem = true AND role.name = 'admin')`);
    if (user.organizationId) {
      qb.andWhere('(user.organizationId = :org)', { org: user.organizationId });
    }
    const otherAdmins = await qb.getCount();
    if (otherAdmins === 0) {
      throw new ConflictException(`Cannot ${verb} the last administrator of this organization`);
    }
  }
}
