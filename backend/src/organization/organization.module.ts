import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Organization } from './organization.entity.js';
import { User } from '../auth/entities/user.entity.js';
import { Role } from '../auth/entities/role.entity.js';
import { TenantBootstrapService } from '../common/tenant/tenant-bootstrap.service.js';
import { OrganizationService } from './organization.service.js';
import { OrganizationController } from './organization.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([Organization, User, Role])],
  controllers: [OrganizationController],
  providers: [TenantBootstrapService, OrganizationService],
  exports: [TypeOrmModule],
})
export class OrganizationModule {}
