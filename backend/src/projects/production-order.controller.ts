import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ProductionOrderService } from './production-order.service.js';
import { CreateProductionOrderDto, UpdateProductionOrderDto, SetStageProgressDto, BulkStageUpdateDto } from './production-order.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@ApiTags('Work Orders (production)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api')
export class ProductionOrderController {
  constructor(private readonly service: ProductionOrderService) {}

  @Post('projects/:projectId/orders')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Create a work order for a project (its own process + quantity) and release it' })
  create(@Param('projectId') projectId: string, @Body() dto: CreateProductionOrderDto) {
    return this.service.create(projectId, dto);
  }

  @Get('projects/:projectId/orders')
  @Roles('admin', 'manager', 'supervisor', 'operator')
  @ApiOperation({ summary: "A project's work orders" })
  list(@Param('projectId') projectId: string) {
    return this.service.listByProject(projectId);
  }

  @Get('orders/dashboard')
  @Roles('admin', 'manager', 'supervisor', 'operator')
  @ApiOperation({ summary: 'Org-wide work-orders dashboard: KPIs, stage funnel and every order with its progress' })
  dashboard() {
    return this.service.dashboard();
  }

  @Get('orders/:id')
  @Roles('admin', 'manager', 'supervisor', 'operator')
  @ApiOperation({ summary: 'Get a work order' })
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Patch('orders/:id')
  @Roles('admin', 'manager', 'supervisor')
  @ApiOperation({ summary: 'Update a work order (customer / status / due date / notes)' })
  update(@Param('id') id: string, @Body() dto: UpdateProductionOrderDto) {
    return this.service.update(id, dto);
  }

  @Delete('orders/:id')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Delete a work order and its per-assembly work orders' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Get('orders/:id/stage-board')
  @Roles('admin', 'manager', 'supervisor', 'operator')
  @ApiOperation({ summary: "Per-order Kanban board: stages + each assembly's per-stage counts" })
  board(@Param('id') id: string) {
    return this.service.getStageBoard(id);
  }

  @Get('orders/:id/progress')
  @Roles('admin', 'manager', 'supervisor', 'operator')
  @ApiOperation({ summary: 'Count-based progress for one work order (overall % + per-stage funnel)' })
  progress(@Param('id') id: string) {
    return this.service.getProgress(id);
  }

  @Get('orders/:id/audit')
  @Roles('admin', 'manager', 'supervisor', 'operator')
  @ApiOperation({ summary: 'Audit view: every assembly with per-stage status, counts, stamps, people, time and holds — one call' })
  audit(@Param('id') id: string) {
    return this.service.getAudit(id);
  }

  @Get('orders/:id/nodes/:nodeId/stages')
  @Roles('admin', 'manager', 'supervisor', 'operator')
  @ApiOperation({ summary: "One assembly's stages within this work order (with quantity counts)" })
  nodeStages(@Param('id') id: string, @Param('nodeId') nodeId: string) {
    return this.service.getNodeStages(id, nodeId);
  }

  @Get('orders/:id/nodes/:nodeId/audit')
  @Roles('admin', 'manager', 'supervisor', 'operator')
  @ApiOperation({ summary: "One assembly's audit trail in this work order: time entries + NCRs" })
  nodeAudit(@Param('id') id: string, @Param('nodeId') nodeId: string) {
    return this.service.getNodeAudit(id, nodeId);
  }

  // NOTE: declared BEFORE 'orders/:id/stages/:wosId' so 'bulk' is never captured as a :wosId.
  @Patch('orders/:id/stages/bulk')
  @Roles('admin', 'manager', 'supervisor', 'operator')
  @ApiOperation({ summary: 'Batch update: apply one stage change to many assemblies (qtyDone or status)' })
  bulkSetProgress(@Param('id') id: string, @Body() dto: BulkStageUpdateDto) {
    return this.service.bulkStageUpdate(id, dto);
  }

  @Patch('orders/:id/stages/:wosId')
  @Roles('admin', 'manager', 'supervisor', 'operator')
  @ApiOperation({ summary: 'Update a stage (qtyDone stepper, or status for qty=1 / skip)' })
  setProgress(@Param('id') id: string, @Param('wosId') wosId: string, @Body() dto: SetStageProgressDto) {
    return this.service.setStageProgress(id, wosId, dto);
  }
}
