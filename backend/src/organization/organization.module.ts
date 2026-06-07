import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Organization } from './organization.entity.js';
import { User } from '../auth/entities/user.entity.js';
import { TenantBootstrapService } from '../common/tenant/tenant-bootstrap.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Organization, User])],
  providers: [TenantBootstrapService],
  exports: [TypeOrmModule],
})
export class OrganizationModule {}
