import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { User } from '../auth/entities/user.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { hasPermission } from '../rbac/permission-catalog.js';

export interface SearchScope {
  /** The caller's effective permission set — categories are gated by it. */
  permissions: ReadonlySet<string>;
}

/**
 * Global quick-search. Tenant-scoped and permission-aware:
 *  - results never cross organizations
 *  - each category only returns rows the caller could open anyway
 *    (work orders need work-orders.view, people need users.view)
 *  - user matches are projected to safe display fields only
 */
@Injectable()
export class SearchService {
  constructor(
    @InjectRepository(WorkOrder) private readonly woRepo: Repository<WorkOrder>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  async search(query: string, scope: SearchScope, limit = 10): Promise<{
    workOrders: any[];
    users: any[];
  }> {
    const q = `%${query.toLowerCase()}%`;
    const org = TenantContext.getOrganizationId();

    let workOrders: any[] = [];
    if (hasPermission(scope.permissions, 'work-orders.view')) {
      const qb = this.woRepo.createQueryBuilder('wo')
        .where('LOWER(wo.order_number) LIKE :q', { q })
        .take(limit);
      if (org) qb.andWhere('wo.organization_id = :org', { org });
      workOrders = await qb.getMany();
    }

    let users: any[] = [];
    if (hasPermission(scope.permissions, 'users.view')) {
      const qb = this.userRepo.createQueryBuilder('u')
        .where(new Brackets((w) => {
          w.where('LOWER(u.first_name) LIKE :q', { q })
            .orWhere('LOWER(u.last_name) LIKE :q', { q })
            .orWhere('LOWER(u.employee_id) LIKE :q', { q });
        }))
        .andWhere('u.is_active = true')
        .take(limit);
      if (org) {
        qb.andWhere('(u.organization_id = :org OR u.organization_id IS NULL)', { org });
        // Platform operator accounts never surface inside tenant search.
        qb.innerJoin('u.role', 'role')
          .andWhere(`NOT (role.is_system = true AND role.name = 'platform-admin')`);
      }
      const rows = await qb.getMany();
      // Safe projection — never serialize whole User entities into search hits.
      users = rows.map((u) => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        employeeId: u.employeeId,
        email: u.email,
      }));
    }

    return { workOrders, users };
  }
}
