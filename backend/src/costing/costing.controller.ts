import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CostingService } from './costing.service.js';
import { UpdateCostingSettingsDto } from './costing.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

@ApiTags('Costing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/costing')
export class CostingController {
  constructor(private readonly service: CostingService) {}

  @Get('settings')
  @RequirePermissions('costing.view')
  @ApiOperation({ summary: 'Costing settings (default labor rate, overhead %, currency)' })
  getSettings() {
    return this.service.getSettings();
  }

  @Put('settings')
  @RequirePermissions('costing.manage')
  @ApiOperation({ summary: 'Update costing settings (audited)' })
  updateSettings(@Body() dto: UpdateCostingSettingsDto) {
    return this.service.updateSettings(dto);
  }

  @Get('orders')
  @RequirePermissions('costing.view')
  @ApiOperation({ summary: 'Org-wide cost overview: every production order with labor/material/overhead roll-up' })
  ordersOverview() {
    return this.service.ordersOverview();
  }

  @Get('order/:id')
  @RequirePermissions('costing.view')
  @ApiOperation({ summary: 'Full cost breakdown of one production order: actual vs estimate, per-assembly and per-material' })
  order(@Param('id') id: string) {
    return this.service.orderCost(id);
  }

  @Get('project/:id')
  @RequirePermissions('costing.view')
  @ApiOperation({ summary: 'Project cost roll-up across all its production orders' })
  project(@Param('id') id: string) {
    return this.service.projectCost(id);
  }

  @Get('work-order/:id')
  @RequirePermissions('costing.view')
  @ApiOperation({ summary: 'Labor + material cost roll-up for one per-assembly work order' })
  workOrder(@Param('id') id: string) {
    return this.service.workOrderCost(id);
  }
}
