import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DeepPartial } from 'typeorm';
import { Organization } from '../../organization/organization.entity.js';
import { User } from '../../auth/entities/user.entity.js';

/**
 * Ensures a default tenant exists and every user belongs to one — on every boot.
 *
 * Idempotent, and replaces the need to run the TenantFoundation migration by hand
 * (the typeorm CLI can't load the TS datasource under Node's type-strip mode).
 * Runs after TypeORM has synchronized the schema, so the organizations table and
 * users.organization_id column already exist.
 */
@Injectable()
export class TenantBootstrapService implements OnModuleInit {
  private readonly logger = new Logger('TenantBootstrap');

  constructor(
    @InjectRepository(Organization) private readonly orgRepo: Repository<Organization>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      let org = await this.orgRepo.findOne({ where: { slug: 'default' } as any });
      if (!org) {
        org = await this.orgRepo.save(
          this.orgRepo.create({ name: 'Default Organization', slug: 'default', isActive: true } as DeepPartial<Organization>),
        );
        this.logger.log('Created default organization');
      }
      if (!org) {
        this.logger.error('Tenant bootstrap skipped: default organization could not be resolved');
        return;
      }
      const res = await this.userRepo
        .createQueryBuilder()
        .update()
        .set({ organizationId: org.id })
        .where('organization_id IS NULL')
        .execute();
      if (res.affected) {
        this.logger.log(`Assigned ${res.affected} user(s) to the default organization`);
      }
    } catch (e) {
      // Never block boot on this — log and move on (e.g. first run before sync).
      this.logger.error(`Tenant bootstrap skipped: ${(e as Error).message}`);
    }
  }
}
