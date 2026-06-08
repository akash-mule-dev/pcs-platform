import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organization } from './organization.entity.js';
import { CreateOrganizationDto } from './dto/create-organization.dto.js';
import { UpdateOrganizationDto } from './dto/update-organization.dto.js';

/**
 * Platform-level org provisioning. Organizations ARE the tenants, so this is
 * intentionally NOT tenant-scoped — it returns/creates across all orgs and is
 * gated to the platform operator role at the controller. (No RLS policy applies
 * to the organizations table since it has no organization_id of its own.)
 */
@Injectable()
export class OrganizationService {
  constructor(
    @InjectRepository(Organization) private readonly repo: Repository<Organization>,
  ) {}

  findAll(): Promise<Organization[]> {
    return this.repo.find({ order: { createdAt: 'ASC' } });
  }

  async findOne(id: string): Promise<Organization> {
    const org = await this.repo.findOne({ where: { id } });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async create(dto: CreateOrganizationDto): Promise<Organization> {
    const exists = await this.repo.findOne({ where: { slug: dto.slug } });
    if (exists) throw new ConflictException('An organization with this slug already exists');
    return this.repo.save(
      this.repo.create({
        name: dto.name,
        slug: dto.slug,
        description: dto.description ?? null,
        isActive: true,
      }),
    );
  }

  async update(id: string, dto: UpdateOrganizationDto): Promise<Organization> {
    const org = await this.findOne(id);
    if (dto.name !== undefined) org.name = dto.name;
    if (dto.description !== undefined) org.description = dto.description;
    if (dto.isActive !== undefined) org.isActive = dto.isActive;
    return this.repo.save(org);
  }
}
