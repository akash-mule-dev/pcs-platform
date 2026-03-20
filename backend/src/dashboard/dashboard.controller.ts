import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { MemoryCacheInterceptor, CacheTTL } from '../common/interceptors/cache.interceptor.js';

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(MemoryCacheInterceptor)
@Controller('api/dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('summary')
  @CacheTTL(15) // Cache for 15 seconds
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

  @Get('oee')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'OEE (Overall Equipment Effectiveness)' })
  getOEE(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    return this.service.getOEE(startDate, endDate);
  }

  @Get('export')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Export report data' })
  getExportData(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    return this.service.getExportData(startDate, endDate);
  }
}
