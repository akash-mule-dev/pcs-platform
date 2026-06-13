import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { Organization } from './organization.entity.js';
import { User } from '../auth/entities/user.entity.js';
import { Role } from '../auth/entities/role.entity.js';
import { TenantBootstrapService } from '../common/tenant/tenant-bootstrap.service.js';
import { OrganizationService } from './organization.service.js';
import { OrganizationController } from './organization.controller.js';
import { CompanyController } from './company.controller.js';
import { LibraryModule } from '../library/library.module.js';
import { JWT_SECRET, JWT_EXPIRES_IN } from '../common/constants/jwt.constant.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Organization, User, Role]),
    LibraryModule,
    JwtModule.register({ secret: JWT_SECRET, signOptions: { expiresIn: JWT_EXPIRES_IN } }),
  ],
  controllers: [OrganizationController, CompanyController],
  providers: [TenantBootstrapService, OrganizationService],
  exports: [TypeOrmModule],
})
export class OrganizationModule {}
