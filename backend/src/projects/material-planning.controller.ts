import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { MaterialRequirementsService } from './material-requirements.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

/**
 * Raw-material planning endpoints:
 *  - the project's per-unit bill of materials (from the assembly tree),
 *  - a production order's scaled requirement + fulfillment/coverage,
 *  - one-click creation of missing material masters.
 */
@ApiTags('Material planning')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api')
export class MaterialPlanningController {
  constructor(private readonly service: MaterialRequirementsService) {}

  @Get('projects/:id/material-requirements')
  @RequirePermissions('projects.view')
  @ApiOperation({ summary: 'Per-unit raw-material requirement of the project design (BOM from the assembly tree)' })
  projectRequirements(@Param('id') id: string) {
    return this.service.projectRequirements(id);
  }

  @Post('projects/:id/material-requirements/sync-materials')
  @RequirePermissions('materials.manage')
  @ApiOperation({ summary: 'Create material masters for requirement lines that have no matching material yet' })
  syncMaterials(@Param('id') id: string) {
    return this.service.syncMaterials(id);
  }

  @Get('orders/:orderId/material-requirements')
  @RequirePermissions('production-orders.view')
  @ApiOperation({ summary: "Order requirement (per-unit BOM × order quantity) with issued/remaining/stock coverage" })
  orderRequirements(@Param('orderId') orderId: string) {
    return this.service.orderRequirements(orderId);
  }
}
