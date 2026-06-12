import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  REQUIRE_ANY_PERMISSION_KEY,
  REQUIRE_PERMISSIONS_KEY,
} from '../../common/decorators/require-permissions.decorator.js';
import { hasPermission } from '../permission-catalog.js';
import { RolePermissionsResolver } from '../role-permissions.resolver.js';

/**
 * Enforces @RequirePermissions / @RequireAnyPermission on routes.
 * Use together with JwtAuthGuard: @UseGuards(JwtAuthGuard, PermissionsGuard).
 *
 * Routes without permission metadata pass through (authentication-only),
 * so the guard is safe to apply at controller level.
 *
 * RbacModule is @Global, so this guard can be referenced from any module
 * without importing RbacModule explicitly.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: RolePermissionsResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const requiredAll = this.reflector.getAllAndOverride<string[]>(REQUIRE_PERMISSIONS_KEY, targets);
    const requiredAny = this.reflector.getAllAndOverride<string[]>(REQUIRE_ANY_PERMISSION_KEY, targets);

    if (!requiredAll?.length && !requiredAny?.length) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) throw new UnauthorizedException();

    const access = await this.resolver.resolveForUser(user);

    // Tenant integrity: a custom role only ever applies inside its own org.
    if (access.role.organizationId && access.role.organizationId !== user.organizationId) {
      throw new ForbiddenException('Role does not belong to your organization');
    }

    // Expose the resolved set for handlers needing contextual checks (e.g. "self or permission").
    request.permissions = access.permissions;

    if (requiredAll?.length) {
      const missing = requiredAll.filter((p) => !hasPermission(access.permissions, p));
      if (missing.length) {
        throw new ForbiddenException(`Missing permission${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`);
      }
    }

    if (requiredAny?.length && !requiredAny.some((p) => hasPermission(access.permissions, p))) {
      throw new ForbiddenException(`Requires one of: ${requiredAny.join(', ')}`);
    }

    return true;
  }
}
