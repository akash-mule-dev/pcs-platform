import { EventSubscriber, EntitySubscriberInterface, InsertEvent } from 'typeorm';
import { TenantContext } from './tenant-context.js';

/**
 * Global write-stamp for tenant-owned data.
 *
 * On every insert, if the target entity has an `organization_id` column and the
 * value isn't already set, stamp it from the current request's TenantContext.
 * This is the "belt" to TenantScopedService.create's "suspenders" — it covers
 * the core services that don't (yet) go through that base class, so new rows are
 * always tagged with their tenant. Postgres RLS (WITH CHECK) is the DB-level
 * backstop that *enforces* this; this subscriber just makes the common path
 * correct without editing every create() call site.
 *
 * Note: TypeORM QueryBuilder `.insert()` bypasses subscribers; those few call
 * sites are covered by RLS / explicit stamping instead.
 */
@EventSubscriber()
export class TenantSubscriber implements EntitySubscriberInterface {
  beforeInsert(event: InsertEvent<any>): void {
    const hasOrgColumn = event.metadata.columns.some(
      (c) => c.propertyName === 'organizationId',
    );
    if (!hasOrgColumn) return;

    const entity = event.entity as { organizationId?: string | null } | undefined;
    if (entity && entity.organizationId == null) {
      const orgId = TenantContext.getOrganizationId();
      if (orgId) entity.organizationId = orgId;
    }
  }
}
