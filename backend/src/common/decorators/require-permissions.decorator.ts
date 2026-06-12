import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSIONS_KEY = 'require_permissions_all';
export const REQUIRE_ANY_PERMISSION_KEY = 'require_permissions_any';

/**
 * Route/controller needs ALL of the listed fine-grained permissions
 * (`<feature>.<action>` keys from rbac/permission-catalog.ts).
 * Enforced by PermissionsGuard.
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(REQUIRE_PERMISSIONS_KEY, permissions);

/** Route/controller needs AT LEAST ONE of the listed permissions. */
export const RequireAnyPermission = (...permissions: string[]) =>
  SetMetadata(REQUIRE_ANY_PERMISSION_KEY, permissions);
