import { Column, Index } from 'typeorm';

/**
 * Base class for any entity owned by a tenant (organization).
 *
 * Extend this on every domain entity so it gets an `organization_id` column.
 * Combined with TenantContext + tenant-scoped repositories (and, as hardening,
 * Postgres Row-Level Security), this is what isolates customers from each other.
 *
 * `organizationId` is nullable during the rollout so the column can be added and
 * backfilled without downtime; tighten to NOT NULL once every row is backfilled.
 */
export abstract class TenantOwnedEntity {
  @Index()
  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId: string | null;
}
