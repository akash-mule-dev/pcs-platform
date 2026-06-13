import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrganizationService } from './organization.service.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

/**
 * Tenant-facing company profile — every organization's own admins/managers can
 * view and edit THEIR company's details. Scoped to the caller's org via tenant
 * context (no id in the path), distinct from the platform `/api/organizations`
 * provisioning API.
 */
@ApiTags('Company')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/company')
export class CompanyController {
  constructor(private readonly service: OrganizationService) {}

  @Get()
  @RequirePermissions('company.view')
  @ApiOperation({ summary: "Get the caller's own company profile" })
  getOwn() {
    return this.service.getOwn();
  }

  @Patch()
  @RequirePermissions('company.manage')
  @ApiOperation({ summary: "Update the caller's own company profile (name, description, contact/address)" })
  updateOwn(@Body() dto: UpdateCompanyDto) {
    return this.service.updateOwn(dto);
  }
}
