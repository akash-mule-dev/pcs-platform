import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';
import { MemoryCacheInterceptor, CacheTTL } from '../common/interceptors/cache.interceptor.js';

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(MemoryCacheInterceptor)
@Controller('api/dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('summary')
  @RequirePermissions('dashboard.view')
  @CacheTTL(15) // Cache for 15 seconds
  @ApiOperation({ summary: 'Dashboard summary' })
  getSummary() {
    return this.service.getSummary();
  }

  @Get('live-status')
  @RequirePermissions('dashboard.view')
  @ApiOperation({ summary: 'Live status of active entries' })
  getLiveStatus() {
    return this.service.getLiveStatus();
  }

  @Get('operator-performance')
  @RequirePermissions('dashboard.analytics')
  @ApiOperation({ summary: 'Operator performance metrics' })
  getOperatorPerformance() {
    return this.service.getOperatorPerformance();
  }

  @Get('stage-analytics')
  @RequirePermissions('dashboard.analytics')
  @ApiOperation({ summary: 'Stage analytics' })
  getStageAnalytics() {
    return this.service.getStageAnalytics();
  }

  @Get('oee')
  @RequirePermissions('dashboard.analytics')
  @ApiOperation({ summary: 'OEE (Overall Equipment Effectiveness)' })
  getOEE(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    return this.service.getOEE(startDate, endDate);
  }

  @Get('export')
  @RequirePermissions('dashboard.export')
  @ApiOperation({ summary: 'Export report data' })
  getExportData(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    return this.service.getExportData(startDate, endDate);
  }
}
