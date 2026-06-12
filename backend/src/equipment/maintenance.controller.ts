import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { MaintenanceService } from './maintenance.service.js';
import {
  CreateMaintenancePlanDto, UpdateMaintenancePlanDto,
  CreateMaintenanceOrderDto, UpdateMaintenanceOrderDto,
} from './dto/maintenance.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

@ApiTags('Maintenance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/maintenance')
export class MaintenanceController {
  constructor(private readonly service: MaintenanceService) {}

  @Get('plans') @RequirePermissions('equipment.view') listPlans() { return this.service.listPlans(); }
  @Post('plans') @RequirePermissions('equipment.manage') createPlan(@Body() dto: CreateMaintenancePlanDto) { return this.service.createPlan(dto); }
  @Patch('plans/:id') @RequirePermissions('equipment.manage') updatePlan(@Param('id') id: string, @Body() dto: UpdateMaintenancePlanDto) { return this.service.updatePlan(id, dto); }
  @Delete('plans/:id') @RequirePermissions('equipment.manage') removePlan(@Param('id') id: string) { return this.service.removePlan(id); }

  @Get('due')
  @RequirePermissions('equipment.view')
  @ApiOperation({ summary: 'Maintenance plans whose next service is due' })
  due() { return this.service.due(); }

  @Get('orders')
  @RequirePermissions('equipment.view') @ApiQuery({ name: 'status', required: false }) listOrders(@Query('status') status?: string) { return this.service.listOrders(status); }
  @Post('orders') @RequirePermissions('equipment.maintain') createOrder(@Body() dto: CreateMaintenanceOrderDto) { return this.service.createOrder(dto); }
  @Patch('orders/:id') @RequirePermissions('equipment.maintain') updateOrder(@Param('id') id: string, @Body() dto: UpdateMaintenanceOrderDto) { return this.service.updateOrder(id, dto); }
}
