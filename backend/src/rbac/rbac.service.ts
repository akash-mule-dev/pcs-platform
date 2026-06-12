/**
 * @deprecated Superseded by the fine-grained RBAC modules:
 *  - roles.service.ts          — role management (system + custom roles)
 *  - permission-catalog.ts     — the permission catalog & matching logic
 *  - role-permissions.resolver — effective permission resolution (cached)
 *  - guards/permissions.guard  — @RequirePermissions enforcement
 *
 * The legacy per-tenant view/manage override model (role_permissions table)
 * was replaced by custom roles with explicit permission grants. This file is
 * kept only because files cannot be removed in this environment.
 */
export {};
