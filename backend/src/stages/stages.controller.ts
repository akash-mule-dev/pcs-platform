import { Controller, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { StagesService } from './stages.service.js';
import { CreateStageDto } from './dto/create-stage.dto.js';
import { UpdateStageDto } from './dto/update-stage.dto.js';
import { ReorderStagesDto } from './dto/reorder-stages.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

@ApiTags('Stages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api')
export class StagesController {
  constructor(private readonly service: StagesService) {}

  @Post('processes/:processId/stages')
  @RequirePermissions('processes.update')
  @ApiOperation({ summary: 'Create stage for process' })
  create(@Param('processId') processId: string, @Body() dto: CreateStageDto) {
    return this.service.createForProcess(processId, dto);
  }

  @Patch('processes/:processId/stages/reorder')
  @RequirePermissions('processes.update')
  @ApiOperation({ summary: 'Reorder stages' })
  reorder(@Param('processId') processId: string, @Body() dto: ReorderStagesDto) {
    return this.service.reorder(processId, dto.stageIds);
  }

  @Patch('stages/:id')
  @RequirePermissions('processes.update')
  @ApiOperation({ summary: 'Update stage' })
  update(@Param('id') id: string, @Body() dto: UpdateStageDto) {
    return this.service.update(id, dto);
  }

  @Delete('stages/:id')
  @RequirePermissions('processes.update')
  @ApiOperation({ summary: 'Delete stage' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
