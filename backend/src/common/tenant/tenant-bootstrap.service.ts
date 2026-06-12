import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, DeepPartial } from 'typeorm';
import { Organization } from '../../organization/organization.entity.js';
import { User } from '../../auth/entities/user.entity.js';

/**
 * Core tables that carry organization_id and must have pre-existing rows
 * backfilled to the default tenant. New rows are stamped by TenantSubscriber.
 */
const TENANT_TABLES = [
  'products',
  'processes',
  'lines',
  'stations',
  'stages',
  'work_orders',
  'work_order_stages',
  'time_entries',
  'quality_data',
];

/**
 * Ensures a default tenant exists and that every existing row in the core
 * tenant-owned tables belongs to it — on every boot. Idempotent.
 *
 * Runs after TypeORM has synchronized the schema, so the organizations table and
 * the organization_id columns already exist. Each backfill is guarded so a
 * missing column (e.g. on the very first boot before sync completes) never blocks
 * startup.
 */
@Injectable()
export class TenantBootstrapService implements OnModuleInit {
  private readonly logger = new Logger('TenantBootstrap');

  constructor(
    @InjectRepository(Organization) private readonly orgRepo: Repository<Organization>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectDataSource() private readonly dataSource: DataSource,
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

      // 1. Users. Platform operators (org-less by design) are exempt — they
      // administer ALL tenants and must never be claimed by the default org.
      const res = await this.userRepo
        .createQueryBuilder()
        .update()
        .set({ organizationId: org.id })
        .where('organization_id IS NULL')
        .andWhere(
          `role_id NOT IN (SELECT id FROM roles WHERE is_system = true AND name = 'platform-admin')`,
        )
        .execute();
      if (res.affected) {
        this.logger.log(`Assigned ${res.affected} user(s) to the default organization`);
      }

      // 2. Core tenant-owned tables.
      for (const table of TENANT_TABLES) {
        try {
          await this.dataSource.query(
            `UPDATE ${table} SET organization_id = $1 WHERE organization_id IS NULL`,
            [org.id],
          );
        } catch (e) {
          // Column may not exist yet on first boot before synchronize runs.
          this.logger.warn(`Backfill skipped for ${table}: ${(e as Error).message}`);
        }
      }
      this.logger.log('Tenant backfill complete for core tables');
    } catch (e) {
      // Never block boot on this — log and move on.
      this.logger.error(`Tenant bootstrap skipped: ${(e as Error).message}`);
    }
  }
}
