import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Organization } from './organization.entity.js';
import { User } from '../auth/entities/user.entity.js';
import { Role } from '../auth/entities/role.entity.js';
import { CreateOrganizationDto } from './dto/create-organization.dto.js';
import { UpdateOrganizationDto } from './dto/update-organization.dto.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';
import { AuditService } from '../audit/audit.service.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { LibraryService } from '../library/library.service.js';

/** A platform operator acting through the system (req.user shape). */
export interface ImpersonationPrincipal {
  id: string;
  email?: string | null;
  employeeId?: string;
}

const IMPERSONATION_TTL = '30m';

/**
 * Platform-level org provisioning (platform-admin only at the controller).
 * Organizations ARE the tenants, so this is intentionally NOT tenant-scoped.
 *
 * Provisioning can bootstrap the tenant's first admin account in the same
 * transaction so a new organization is immediately usable — its admin then
 * creates users and custom roles from inside the tenant.
 */
@Injectable()
export class OrganizationService {
  constructor(
    @InjectRepository(Organization) private readonly repo: Repository<Organization>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Role) private readonly roleRepo: Repository<Role>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly library: LibraryService,
    private readonly jwt: JwtService,
  ) {}

  /** Tenant organizations only — the platform library org is never listed here. */
  findAll(): Promise<Organization[]> {
    return this.repo.find({ where: { kind: 'tenant' } as any, order: { createdAt: 'ASC' } });
  }

  async findOne(id: string): Promise<Organization> {
    const org = await this.repo.findOne({ where: { id } });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async create(dto: CreateOrganizationDto): Promise<Organization & { initialAdmin?: { id: string; email: string } }> {
    const exists = await this.repo.findOne({ where: { slug: dto.slug } });
    if (exists) throw new ConflictException('An organization with this slug already exists');

    if (dto.initialAdmin) {
      const { email, employeeId } = dto.initialAdmin;
      const userExists = await this.userRepo.findOne({ where: [{ email }, { employeeId }] });
      if (userExists) throw new ConflictException('A user with this email or employee ID already exists');
    }

    const adminRole = dto.initialAdmin
      ? await this.roleRepo.findOne({ where: { name: 'admin', isSystem: true, organizationId: IsNull() } })
      : null;
    if (dto.initialAdmin && !adminRole) {
      throw new BadRequestException('System admin role missing — cannot bootstrap the tenant admin');
    }

    const { org, admin } = await this.dataSource.transaction(async (em) => {
      const createdOrg = await em.getRepository(Organization).save(
        em.getRepository(Organization).create({
          name: dto.name,
          slug: dto.slug,
          description: dto.description ?? null,
          isActive: true,
        }),
      );

      let createdAdmin: User | null = null;
      if (dto.initialAdmin && adminRole) {
        createdAdmin = await em.getRepository(User).save(
          em.getRepository(User).create({
            employeeId: dto.initialAdmin.employeeId,
            email: dto.initialAdmin.email,
            mobileNo: dto.initialAdmin.mobileNo ?? null,
            passwordHash: await bcrypt.hash(dto.initialAdmin.password, 10),
            firstName: dto.initialAdmin.firstName,
            lastName: dto.initialAdmin.lastName,
            roleId: adminRole.id,
            organizationId: createdOrg.id,
            isActive: true,
          }),
        );
      }
      return { org: createdOrg, admin: createdAdmin };
    });

    // New tenants start with the shared library's default processes & templates
    // (best-effort — a seeding hiccup must never fail org provisioning).
    const seeded = await this.library.seedTenant(org.id);

    await this.audit.log({
      userId: TenantContext.get()?.userId ?? null,
      action: 'create',
      entityType: 'organization',
      entityId: org.id,
      newValues: {
        name: org.name,
        slug: org.slug,
        librarySeeded: seeded,
        ...(admin ? { initialAdmin: { id: admin.id, email: admin.email } } : {}),
      },
    });

    return admin ? { ...org, initialAdmin: { id: admin.id, email: admin.email! } } : org;
  }

  async update(id: string, dto: UpdateOrganizationDto): Promise<Organization> {
    const org = await this.findOne(id);
    if (org.kind === 'platform') {
      throw new BadRequestException('The platform library organization cannot be edited as a tenant');
    }
    const oldValues = { name: org.name, isActive: org.isActive };
    if (dto.name !== undefined) org.name = dto.name;
    if (dto.description !== undefined) org.description = dto.description;
    if (dto.isActive !== undefined) org.isActive = dto.isActive;
    const saved = await this.repo.save(org);
    await this.audit.log({
      userId: TenantContext.get()?.userId ?? null,
      action: 'update',
      entityType: 'organization',
      entityId: id,
      oldValues,
      newValues: { name: saved.name, isActive: saved.isActive },
    });
    return saved;
  }

  // ── Company self-service (tenant-facing: the caller's OWN organization) ─────

  /** Public-shaped view of an org for the company-info page. */
  private toCompanyView(org: Organization) {
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      description: org.description,
      kind: org.kind,
      isActive: org.isActive,
      profile: (org.settings?.profile as Record<string, any>) ?? {},
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
    };
  }

  /** The caller's own organization (from tenant context). */
  async getOwn() {
    const orgId = TenantContext.requireOrganizationId();
    const org = await this.repo.findOne({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organization not found');
    return this.toCompanyView(org);
  }

  /** Update the caller's own company profile (never slug/kind/isActive). */
  async updateOwn(dto: UpdateCompanyDto) {
    const orgId = TenantContext.requireOrganizationId();
    const org = await this.repo.findOne({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organization not found');
    if (org.kind === 'platform') {
      throw new ForbiddenException('The platform organization is not an editable company');
    }
    const before = { name: org.name, description: org.description, profile: org.settings?.profile ?? {} };
    if (dto.name !== undefined) org.name = dto.name;
    if (dto.description !== undefined) org.description = dto.description ?? null;
    if (dto.profile !== undefined) {
      org.settings = { ...(org.settings ?? {}), profile: { ...(org.settings?.profile ?? {}), ...dto.profile } };
    }
    const saved = await this.repo.save(org);
    await this.audit.log({
      userId: TenantContext.get()?.userId ?? null,
      action: 'update',
      entityType: 'company',
      entityId: saved.id,
      oldValues: before,
      newValues: { name: saved.name, description: saved.description, profile: saved.settings?.profile ?? {} },
    });
    return this.toCompanyView(saved);
  }

  // ── Support impersonation ───────────────────────────────────────────────────

  /**
   * Mint a short-lived token that lets a platform operator act INSIDE a tenant
   * (as that tenant's admin) to investigate an issue. The operator's real id is
   * preserved in the token (`impersonatedBy`) and the session is audit-logged;
   * the client shows a banner and can exit back to the platform session.
   */
  async impersonate(targetOrgId: string, operator: ImpersonationPrincipal) {
    const org = await this.repo.findOne({ where: { id: targetOrgId } });
    if (!org) throw new NotFoundException('Organization not found');
    if (org.kind === 'platform') throw new BadRequestException('Cannot impersonate the platform organization');
    if (!org.isActive) throw new BadRequestException('Organization is inactive');

    const adminRole = await this.roleRepo.findOne({ where: { name: 'admin', isSystem: true, organizationId: IsNull() } });
    if (!adminRole) throw new BadRequestException('System admin role missing — cannot start a support session');

    const payload = {
      sub: operator.id,
      email: operator.email ?? null,
      employeeId: operator.employeeId,
      role: adminRole.name,
      roleId: adminRole.id,
      organizationId: org.id,
      impersonation: true,
      impersonatedBy: operator.id,
    };
    const accessToken = this.jwt.sign(payload, { expiresIn: IMPERSONATION_TTL });

    await this.audit.log({
      userId: operator.id,
      action: 'impersonate',
      entityType: 'organization',
      entityId: org.id,
      newValues: { organizationName: org.name, slug: org.slug, ttl: IMPERSONATION_TTL },
    });

    return {
      accessToken,
      impersonation: true,
      expiresIn: IMPERSONATION_TTL,
      organization: { id: org.id, name: org.name, slug: org.slug },
      user: {
        id: operator.id,
        email: operator.email ?? null,
        firstName: 'Support',
        lastName: 'Session',
        employeeId: operator.employeeId,
        organizationId: org.id,
        role: { id: adminRole.id, name: adminRole.name, isSystem: true },
        impersonation: { organizationId: org.id, organizationName: org.name },
      },
    };
  }
}
