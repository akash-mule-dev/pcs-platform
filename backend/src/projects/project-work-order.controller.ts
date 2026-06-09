import { Controller, Post, Param, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { WorkOrderGenService } from './work-order-gen.service.js';
import { StatusRollupService } from './status-rollup.service.js';
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
}
