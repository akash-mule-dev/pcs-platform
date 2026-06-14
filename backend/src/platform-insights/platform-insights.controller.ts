import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PlatformInsightsService } from './platform-insights.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

/**
 * Cross-tenant "Company Insights" for the platform operator (super admin).
 * Platform-scoped — held only by the org-less platform-admin role.
 */
@ApiTags('Platform Insights')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('platform-insights.view')
@Controller('api/platform/insights')
export class PlatformInsightsController {
  constructor(private readonly service: PlatformInsightsService) {}

  @Get()
  @ApiOperation({ summary: 'Cross-tenant adoption & usage overview (all tenants + feature matrix)' })
  overview() {
    return this.service.overview();
  }

  @Get(':orgId')
  @ApiOperation({ summary: 'Per-tenant usage deep dive (features used, activity, top users)' })
  tenant(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.service.tenant(orgId);
  }
}
