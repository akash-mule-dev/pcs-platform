import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DeepPartial } from 'typeorm';
import { Skill } from './entities/skill.entity.js';
import { EmployeeSkill } from './entities/employee-skill.entity.js';
import { TenantScopedService } from '../common/tenant/tenant-scoped.service.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { AssignSkillDto } from './dto/workforce.dto.js';

@Injectable()
export class SkillsService extends TenantScopedService<Skill> {
  constructor(
    @InjectRepository(Skill) repo: Repository<Skill>,
    @InjectRepository(EmployeeSkill) private readonly esRepo: Repository<EmployeeSkill>,
  ) {
    super(repo);
  }

  // Skill CRUD inherited (tenant-scoped).

  /** Grant or update a skill/certification for an employee. */
  async assignSkill(dto: AssignSkillDto): Promise<EmployeeSkill> {
    const data = {
      level: dto.level ?? null,
      certifiedAt: dto.certifiedAt ? new Date(dto.certifiedAt) : null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      certifiedBy: TenantContext.get()?.userId ?? null,
      note: dto.note ?? null,
    };
    let es = await this.esRepo.findOne({
      where: { userId: dto.userId, skillId: dto.skillId, organizationId: this.organizationId } as any,
    });
    if (es) {
      Object.assign(es, data);
      return this.esRepo.save(es);
    }
    es = this.esRepo.create({ ...data, userId: dto.userId, skillId: dto.skillId, organizationId: this.organizationId } as DeepPartial<EmployeeSkill>);
    return this.esRepo.save(es);
  }

  listUserSkills(userId: string): Promise<EmployeeSkill[]> {
    return this.esRepo.find({ where: { userId, organizationId: this.organizationId } as any });
  }

  async removeEmployeeSkill(id: string): Promise<void> {
    const es = await this.esRepo.findOne({ where: { id, organizationId: this.organizationId } as any });
    if (!es) throw new NotFoundException('Employee skill not found');
    await this.esRepo.remove(es);
  }

  /** True if the user currently holds a valid (non-expired) certification for the skill. */
  async isQualified(userId: string, skillId: string): Promise<boolean> {
    const es = await this.esRepo.findOne({
      where: { userId, skillId, organizationId: this.organizationId } as any,
    });
    if (!es) return false;
    if (es.expiresAt && new Date(es.expiresAt).getTime() < Date.now()) return false;
    return true;
  }
}
