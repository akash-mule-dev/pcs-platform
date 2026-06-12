import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Role } from '../auth/entities/role.entity.js';
import { SYSTEM_ROLE_NAMES } from './permission-catalog.js';

/**
 * Idempotent boot-time sync of the built-in system roles:
 *  - creates admin / manager / supervisor / operator if missing (org-less)
 *  - flags pre-existing rows (from earlier seeds) as `is_system = true`
 *
 * System role PERMISSIONS are code-defined (permission-catalog.ts), so no
 * grant rows are seeded — they can never drift from the enforcing code.
 */
@Injectable()
export class RbacSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RbacSeedService.name);

  constructor(@InjectRepository(Role) private readonly roleRepo: Repository<Role>) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      for (const name of SYSTEM_ROLE_NAMES) {
        const existing = await this.roleRepo.findOne({ where: { name, organizationId: IsNull() } });
        if (!existing) {
          await this.roleRepo.save(
            this.roleRepo.create({ name, description: `Built-in ${name} role`, isSystem: true, organizationId: null }),
          );
          this.logger.log(`Created system role "${name}"`);
        } else if (!existing.isSystem) {
          existing.isSystem = true;
          await this.roleRepo.save(existing);
          this.logger.log(`Marked existing role "${name}" as system role`);
        }
      }
    } catch (err) {
      // Never block boot on seed sync (e.g. first boot races schema creation).
      this.logger.error(`System role sync failed: ${(err as Error).message}`);
    }
  }
}
