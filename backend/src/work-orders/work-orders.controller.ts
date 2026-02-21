import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { WorkOrdersService } from './work-orders.service.js';
import { CreateWorkOrderDto } from './dto/create-work-order.dto.js';
import { UpdateWorkOrderDto } from './dto/update-work-order.dto.js';
import { UpdateStatusDto } from './dto/update-status.dto.js';
import { AssignWorkOrderDto } from './dto/assign-work-order.dto.js';
import { PageOptionsDto } from '../common/dto/pagination.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@ApiTags('Work Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/work-orders')
export class WorkOrdersController {
  constructor(private readonly service: WorkOrdersService) {}

  @Get()
  @ApiOperation({ summary: 'List work orders' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'priority', required: false })
  findAll(@Query() pageOptions: PageOptionsDto, @Query('status') status?: string, @Query('priority') priority?: string) {
    return this.service.findAll(pageOptions, status, priority);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get work order with stages' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('admin', 'manager', 'supervisor')
  @ApiOperation({ summary: 'Create work order' })
  create(@Body() dto: CreateWorkOrderDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('admin', 'manager', 'supervisor')
  @ApiOperation({ summary: 'Update work order' })
  update(@Param('id') id: string, @Body() dto: UpdateWorkOrderDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/status')
  @Roles('admin', 'manager', 'supervisor')
  @ApiOperation({ summary: 'Update work order status' })
  updateStatus(@Param('id') id: string, @Body() dto: UpdateStatusDto) {
    return this.service.updateStatus(id, dto.status);
  }

  @Post(':id/assign')
  @Roles('admin', 'manager', 'supervisor')
  @ApiOperation({ summary: 'Assign operators to stages' })
  assign(@Param('id') id: string, @Body() dto: AssignWorkOrderDto) {
    return this.service.assign(id, dto);
  }
}
