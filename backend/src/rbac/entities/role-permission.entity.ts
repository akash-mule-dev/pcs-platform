/**
 * @deprecated Legacy per-tenant feature override rows (role_permissions table).
 * Superseded by role-permission-grant.entity.ts (fine-grained grants on custom
 * roles). The entity is no longer registered with TypeORM; the underlying table
 * is left in place (non-destructive) but is not read or written anymore.
 */
export {};
