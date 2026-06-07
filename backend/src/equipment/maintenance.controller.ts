import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { MaintenanceService } from './maintenance.service.js';
import {
  CreateMaintenancePlanDto, UpdateMaintenancePlanDto,
  CreateMaintenanceOrderDto, UpdateMaintenanceOrderDto,
} from './dto/maintenance.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@ApiTags('Maintenance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/maintenance')
export class MaintenanceController {
  constructor(private readonly service: MaintenanceService) {}

  @Get('plans') listPlans() { return this.service.listPlans(); }
  @Post('plans') @Roles('admin', 'manager') createPlan(@Body() dto: CreateMaintenancePlanDto) { return this.service.createPlan(dto); }
  @Patch('plans/:id') @Roles('admin', 'manager') updatePlan(@Param('id') id: string, @Body() dto: UpdateMaintenancePlanDto) { return this.service.updatePlan(id, dto); }
  @Delete('plans/:id') @Roles('admin', 'manager') removePlan(@Param('id') id: string) { return this.service.removePlan(id); }

  @Get('due')
  @ApiOperation({ summary: 'Maintenance plans whose next service is due' })
  due() { return this.service.due(); }

  @Get('orders') @ApiQuery({ name: 'status', required: false }) listOrders(@Query('status') status?: string) { return this.service.listOrders(status); }
  @Post('orders') @Roles('admin', 'manager', 'supervisor') createOrder(@Body() dto: CreateMaintenanceOrderDto) { return this.service.createOrder(dto); }
  @Patch('orders/:id') @Roles('admin', 'manager', 'supervisor') updateOrder(@Param('id') id: string, @Body() dto: UpdateMaintenanceOrderDto) { return this.service.updateOrder(id, dto); }
}
