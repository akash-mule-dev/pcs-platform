import { Controller, Get, Post, Patch, Param, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { WorkOrderGenService } from './work-order-gen.service.js';
import { StatusRollupService } from './status-rollup.service.js';
import { ProjectProgressService } from './project-progress.service.js';
import { ProjectStageService } from './project-stage.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/projects')
export class ProjectWorkOrderController {
  constructor(
    private readonly genService: WorkOrderGenService,
    private readonly rollupService: StatusRollupService,
    private readonly progressService: ProjectProgressService,
    private readonly stageService: ProjectStageService,
  ) {}

  @Post(':id/generate-work-orders')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: "Generate work orders for the project's assemblies against a process" })
  generate(@Param('id') id: string, @Body() body: { processId?: string }) {
    if (!body?.processId) throw new BadRequestException('processId is required');
    return this.genService.generate(id, body.processId);
  }

  @Post(':id/recompute-status')
  @Roles('admin', 'manager', 'supervisor')
  @ApiOperation({ summary: 'Recompute assembly/project status roll-up from work-order stages' })
  recompute(@Param('id') id: string) {
    return this.rollupService.recomputeProject(id);
  }

  @Get(':id/progress')
  @Roles('admin', 'manager', 'supervisor', 'operator')
  @ApiOperation({ summary: 'Project progress: status counts, weight-weighted %, tonnage, and the stage funnel' })
  progress(@Param('id') id: string) {
    return this.progressService.getProgress(id);
  }

  @Get(':id/stages')
  @Roles('admin', 'manager', 'supervisor', 'operator')
  @ApiOperation({ summary: "The stage pipeline of the project's attached process" })
  projectStages(@Param('id') id: string) {
    return this.stageService.getProjectStages(id);
  }

  @Get(':id/nodes/:nodeId/stages')
  @Roles('admin', 'manager', 'supervisor', 'operator')
  @ApiOperation({ summary: "An assembly's per-stage status (from its work order)" })
  nodeStages(@Param('id') id: string, @Param('nodeId') nodeId: string) {
    return this.stageService.getNodeStages(id, nodeId);
  }

  @Patch(':id/nodes/:nodeId/stages/:wosId')
  @Roles('admin', 'manager', 'supervisor', 'operator')
  @ApiOperation({ summary: 'Set an assembly stage status (advances live roll-up)' })
  setNodeStage(@Param('id') id: string, @Param('nodeId') nodeId: string, @Param('wosId') wosId: string, @Body() body: { status?: string }) {
    if (!body?.status) throw new BadRequestException('status is required');
    return this.stageService.setNodeStageStatus(id, nodeId, wosId, body.status);
  }
}
