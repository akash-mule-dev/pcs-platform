/**
 * @deprecated The coarse feature→roles map that used to live here was replaced
 * by the fine-grained permission catalog in `rbac/permission-catalog.ts`
 * (permissions are `<feature>.<action>` keys; roles are DB records — built-in
 * system roles + per-organization custom roles).
 *
 * Re-exported here only for discoverability; import from the catalog directly.
 */
export {
  PERMISSION_CATALOG,
  SYSTEM_ROLE_PERMISSIONS,
  hasPermission,
  isKnownPermission,
} from '../rbac/permission-catalog.js';
