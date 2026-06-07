import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { SpcService } from './spc.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@ApiTags('SPC')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/spc')
export class SpcController {
  constructor(private readonly service: SpcService) {}

  @Get('control-chart')
  @Roles('admin', 'manager', 'supervisor')
  @ApiOperation({ summary: 'SPC control chart + Cp/Cpk + rule violations from measurements' })
  @ApiQuery({ name: 'modelId', required: false })
  @ApiQuery({ name: 'meshName', required: false })
  controlChart(@Query('modelId') modelId?: string, @Query('meshName') meshName?: string) {
    return this.service.controlChart(modelId, meshName);
  }
}
