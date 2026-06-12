import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { SchedulingService } from './scheduling.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

@ApiTags('Scheduling')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/scheduling')
export class SchedulingController {
  constructor(private readonly service: SchedulingService) {}

  @Get('load')
  @RequirePermissions('scheduling.view')
  @ApiOperation({ summary: 'Estimated load vs. capacity by line for a window' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  load(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    return this.service.load(startDate, endDate);
  }
}
