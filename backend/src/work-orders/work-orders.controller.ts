import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { WorkOrdersService } from './work-orders.service.js';
import { CreateWorkOrderDto } from './dto/create-work-order.dto.js';
import { UpdateWorkOrderDto } from './dto/update-work-order.dto.js';
import { UpdateStatusDto } from './dto/update-status.dto.js';
import { AssignWorkOrderDto } from './dto/assign-work-order.dto.js';
import { PageOptionsDto } from '../common/dto/pagination.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

@ApiTags('Work Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/work-orders')
export class WorkOrdersController {
  constructor(private readonly service: WorkOrdersService) {}

  @Get()
  @RequirePermissions('work-orders.view')
  @ApiOperation({ summary: 'List work orders' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'priority', required: false })
  findAll(@Query() pageOptions: PageOptionsDto, @Query('status') status?: string, @Query('priority') priority?: string) {
    return this.service.findAll(pageOptions, status, priority);
  }

  // --- Static paths MUST come before :id param routes ---

  @Get('kanban')
  @RequirePermissions('work-orders.view')
  @ApiOperation({ summary: 'Stage kanban: every work order placed at its first incomplete stage, computed live from count-based stage rows' })
  @ApiQuery({ name: 'projectId', required: false })
  @ApiQuery({ name: 'orderId', required: false })
  @ApiQuery({ name: 'q', required: false })
  kanban(@Query('projectId') projectId?: string, @Query('orderId') orderId?: string, @Query('q') q?: string) {
    return this.service.kanban({ projectId: projectId || undefined, orderId: orderId || undefined, q: q || undefined });
  }

  @Post()
  @RequirePermissions('work-orders.create')
  @ApiOperation({ summary: 'Create work order' })
  create(@Body() dto: CreateWorkOrderDto) {
    return this.service.create(dto);
  }

  @Post('batch/status')
  @RequirePermissions('work-orders.bulk-update')
  @ApiOperation({ summary: 'Batch update work order statuses' })
  batchUpdateStatus(@Body() body: { ids: string[]; status: string }) {
    return this.service.batchUpdateStatus(body.ids, body.status as any);
  }

  @Post('batch/assign-line')
  @RequirePermissions('work-orders.bulk-update')
  @ApiOperation({ summary: 'Batch assign work orders to a line' })
  batchAssignLine(@Body() body: { ids: string[]; lineId: string }) {
    return this.service.batchAssignLine(body.ids, body.lineId);
  }

  // --- :id param routes ---

  @Get(':id')
  @RequirePermissions('work-orders.view')
  @ApiOperation({ summary: 'Get work order with stages' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id/status')
  @RequirePermissions('work-orders.update')
  @ApiOperation({ summary: 'Update work order status' })
  updateStatus(@Param('id') id: string, @Body() dto: UpdateStatusDto) {
    return this.service.updateStatus(id, dto.status);
  }

  @Patch(':id')
  @RequirePermissions('work-orders.update')
  @ApiOperation({ summary: 'Update work order' })
  update(@Param('id') id: string, @Body() dto: UpdateWorkOrderDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/stages/:stageId/status')
  @RequirePermissions('work-orders.execute')
  @ApiOperation({ summary: 'Update work order stage status' })
  updateStageStatus(
    @Param('id') id: string,
    @Param('stageId') stageId: string,
    @Body() body: { status: string },
  ) {
    return this.service.updateStageStatus(id, stageId, body.status as any);
  }

  @Post(':id/assign')
  @RequirePermissions('work-orders.update')
  @ApiOperation({ summary: 'Assign operators to stages' })
  assign(@Param('id') id: string, @Body() dto: AssignWorkOrderDto) {
    return this.service.assign(id, dto);
  }
}
