import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ImportMonitorService } from './import-monitor.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

/**
 * Tenant-wide package monitor (all projects of the caller's org):
 * live pipeline (queue positions + stage/%) and the full upload history.
 */
@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/imports')
export class ImportMonitorController {
  constructor(private readonly monitorService: ImportMonitorService) {}

  @Get('monitor')
  @RequirePermissions('projects.view')
  @ApiOperation({ summary: 'Live org-wide pipeline: active packages (queue position, stage, %) + KPI counts' })
  monitor() {
    return this.monitorService.monitor();
  }

  @Get('history')
  @RequirePermissions('projects.view')
  @ApiOperation({ summary: 'Org-wide package upload history (filter by projects, sort by upload time, paged)' })
  history(
    @Query('projects') projects?: string,
    @Query('sort') sort?: 'asc' | 'desc',
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.monitorService.history({
      projectIds: projects ? projects.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      sort: sort === 'asc' ? 'asc' : 'desc',
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }
}
