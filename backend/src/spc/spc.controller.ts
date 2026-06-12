import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { SpcService } from './spc.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

@ApiTags('SPC')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/spc')
export class SpcController {
  constructor(private readonly service: SpcService) {}

  @Get('control-chart')
  @RequirePermissions('quality-analysis.view')
  @ApiOperation({ summary: 'SPC control chart + Cp/Cpk + rule violations from measurements' })
  @ApiQuery({ name: 'modelId', required: false })
  @ApiQuery({ name: 'meshName', required: false })
  controlChart(@Query('modelId') modelId?: string, @Query('meshName') meshName?: string) {
    return this.service.controlChart(modelId, meshName);
  }
}
