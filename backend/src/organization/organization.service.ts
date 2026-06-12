import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Organization } from './organization.entity.js';
import { User } from '../auth/entities/user.entity.js';
import { Role } from '../auth/entities/role.entity.js';
import { CreateOrganizationDto } from './dto/create-organization.dto.js';
import { UpdateOrganizationDto } from './dto/update-organization.dto.js';
import { AuditService } from '../audit/audit.service.js';
import { TenantContext } from '../common/tenant/tenant-context.js';

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
  ) {}

  findAll(): Promise<Organization[]> {
    return this.repo.find({ order: { createdAt: 'ASC' } });
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

    await this.audit.log({
      userId: TenantContext.get()?.userId ?? null,
      action: 'create',
      entityType: 'organization',
      entityId: org.id,
      newValues: {
        name: org.name,
        slug: org.slug,
        ...(admin ? { initialAdmin: { id: admin.id, email: admin.email } } : {}),
      },
    });

    return admin ? { ...org, initialAdmin: { id: admin.id, email: admin.email! } } : org;
  }

  async update(id: string, dto: UpdateOrganizationDto): Promise<Organization> {
    const org = await this.findOne(id);
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
}
