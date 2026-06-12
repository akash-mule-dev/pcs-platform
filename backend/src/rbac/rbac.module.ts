import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Role } from '../auth/entities/role.entity.js';
import { User } from '../auth/entities/user.entity.js';
import { RolePermissionGrant } from './entities/role-permission-grant.entity.js';
import { RolePermissionsResolver } from './role-permissions.resolver.js';
import { PermissionsGuard } from './guards/permissions.guard.js';
import { RolesService } from './roles.service.js';
import { RolesController } from './roles.controller.js';
import { RbacSeedService } from './rbac-seed.service.js';

/**
 * Fine-grained RBAC: permission catalog, system + custom roles, grants,
 * and the PermissionsGuard/RolePermissionsResolver enforcing them.
 *
 * @Global so PermissionsGuard (referenced via @UseGuards in every feature
 * controller) can resolve its dependencies from any module without each
 * module importing RbacModule.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Role, RolePermissionGrant, User])],
  controllers: [RolesController],
  providers: [RolesService, RolePermissionsResolver, PermissionsGuard, RbacSeedService],
  exports: [RolesService, RolePermissionsResolver, PermissionsGuard, TypeOrmModule],
})
export class RbacModule {}
