import { AsyncLocalStorage } from 'async_hooks';

/**
 * Per-request tenant context.
 *
 * Shared-DB multi-tenancy: every request runs inside an async context that
 * carries the caller's organizationId (set by TenantInterceptor from the JWT).
 * Tenant-aware repositories/services read it via getOrganizationId() to scope
 * every query, so isolation doesn't depend on each call site remembering a WHERE.
 */
export interface TenantStore {
  organizationId: string | null;
  userId: string | null;
}

const storage = new AsyncLocalStorage<TenantStore>();

export const TenantContext = {
  /** Run a function within a tenant scope (used by tests / jobs). */
  run<T>(store: TenantStore, fn: () => T): T {
    return storage.run(store, fn);
  },

  /** Set the tenant for the current async execution (used by the interceptor). */
  set(store: TenantStore): void {
    storage.enterWith(store);
  },

  get(): TenantStore | undefined {
    return storage.getStore();
  },

  /** The current tenant id, or null for unauthenticated/system contexts. */
  getOrganizationId(): string | null {
    return storage.getStore()?.organizationId ?? null;
  },

  /**
   * The current tenant id, or throw if absent. Use in tenant-scoped writes
   * where operating without a tenant would be a bug.
   */
  requireOrganizationId(): string {
    const id = storage.getStore()?.organizationId ?? null;
    if (!id) {
      throw new Error('No tenant in context (organizationId missing)');
    }
    return id;
  },
};
