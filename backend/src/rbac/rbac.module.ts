import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RolePermission } from './entities/role-permission.entity.js';
import { RbacService } from './rbac.service.js';
import { RbacController } from './rbac.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([RolePermission])],
  controllers: [RbacController],
  providers: [RbacService],
  exports: [RbacService, TypeOrmModule],
})
export class RbacModule {}
