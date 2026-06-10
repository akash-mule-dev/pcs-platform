import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ProjectQualityService } from './project-quality.service.js';
import { RecordNodeQualityDto, RaiseNodeNcrDto } from './dto/node-quality.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/projects')
export class ProjectQualityController {
  constructor(private readonly quality: ProjectQualityService) {}

  @Get(':id/quality-summary')
  @Roles('admin', 'manager', 'supervisor', 'operator')
  @ApiOperation({ summary: 'Per-node quality status + open-NCR map (badges + shipping gate)' })
  summary(@Param('id') id: string) {
    return this.quality.projectQualitySummary(id);
  }

  @Get(':id/nodes/:nodeId/quality')
  @Roles('admin', 'manager', 'supervisor', 'operator')
  @ApiOperation({ summary: "An assembly node's quality inspections" })
  list(@Param('id') id: string, @Param('nodeId') nodeId: string) {
    return this.quality.listNodeQuality(id, nodeId);
  }

  @Post(':id/nodes/:nodeId/quality')
  @Roles('admin', 'manager', 'supervisor', 'operator')
  @ApiOperation({ summary: 'Record a quality check on a node (auto-fails out-of-tolerance measurements)' })
  record(@Param('id') id: string, @Param('nodeId') nodeId: string, @Body() dto: RecordNodeQualityDto) {
    return this.quality.recordNodeQuality(id, nodeId, dto);
  }

  @Post(':id/nodes/:nodeId/ncr')
  @Roles('admin', 'manager', 'supervisor', 'operator')
  @ApiOperation({ summary: 'Raise an NCR pre-filled from a node (links node/project/work-order/quality record)' })
  raiseNcr(@Param('id') id: string, @Param('nodeId') nodeId: string, @Body() dto: RaiseNodeNcrDto) {
    return this.quality.raiseNodeNcr(id, nodeId, dto);
  }
}
