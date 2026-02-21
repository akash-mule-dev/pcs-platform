import { Controller, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { StagesService } from './stages.service.js';
import { CreateStageDto } from './dto/create-stage.dto.js';
import { UpdateStageDto } from './dto/update-stage.dto.js';
import { ReorderStagesDto } from './dto/reorder-stages.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@ApiTags('Stages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api')
export class StagesController {
  constructor(private readonly service: StagesService) {}

  @Post('processes/:processId/stages')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Create stage for process' })
  create(@Param('processId') processId: string, @Body() dto: CreateStageDto) {
    return this.service.createForProcess(processId, dto);
  }

  @Patch('processes/:processId/stages/reorder')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Reorder stages' })
  reorder(@Param('processId') processId: string, @Body() dto: ReorderStagesDto) {
    return this.service.reorder(processId, dto.stageIds);
  }

  @Patch('stages/:id')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Update stage' })
  update(@Param('id') id: string, @Body() dto: UpdateStageDto) {
    return this.service.update(id, dto);
  }

  @Delete('stages/:id')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Delete stage' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
