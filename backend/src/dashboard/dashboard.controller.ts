import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Dashboard summary' })
  getSummary() {
    return this.service.getSummary();
  }

  @Get('live-status')
  @ApiOperation({ summary: 'Live status of active entries' })
  getLiveStatus() {
    return this.service.getLiveStatus();
  }

  @Get('operator-performance')
  @Roles('admin', 'manager', 'supervisor')
  @ApiOperation({ summary: 'Operator performance metrics' })
  getOperatorPerformance() {
    return this.service.getOperatorPerformance();
  }

  @Get('stage-analytics')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Stage analytics' })
  getStageAnalytics() {
    return this.service.getStageAnalytics();
  }
}
