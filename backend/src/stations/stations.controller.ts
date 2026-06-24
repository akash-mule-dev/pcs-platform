import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { StationsService } from './stations.service.js';
import { CreateStationDto } from './dto/create-station.dto.js';
import { UpdateStationDto } from './dto/update-station.dto.js';
import { StationStatusDto } from './dto/station-status.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';
import { hasPermission } from '../rbac/permission-catalog.js';

@ApiTags('Stations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api')
export class StationsController {
  constructor(private readonly service: StationsService) {}

  /** Cost figures (machine rate, machine cost) are shown only to costing.view holders. */
  private canSeeCost(req: any): boolean {
    const perms = req?.permissions as Set<string> | undefined;
    return !!perms && hasPermission(perms, 'costing.view');
  }

  // ── Directory + aggregates (read) ───────────────────────────────────────────

  @Get('stations')
  @RequirePermissions('stations.view')
  @ApiOperation({ summary: 'Org-wide station directory (filterable, with live busy + equipment count)' })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'active', required: false, type: Boolean })
  list(
    @Req() req: any,
    @Query('q') q?: string,
    @Query('lineId') lineId?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('active') active?: string,
  ) {
    const activeFlag = active === 'true' ? true : active === 'false' ? false : undefined;
    return this.service.list({ q, lineId, type, status, active: activeFlag }, this.canSeeCost(req));
  }

  @Get('stations/utilization')
  @RequirePermissions('stations.view')
  @ApiOperation({ summary: 'Per-station utilization & cost over a window (defaults to last 7 days)' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  utilization(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string) {
    return this.service.utilization(from, to, this.canSeeCost(req));
  }

  @Get('stations/:id/utilization')
  @RequirePermissions('stations.view')
  @ApiOperation({ summary: 'One station: utilization & cost over a window' })
  stationUtilization(@Req() req: any, @Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.service.utilization(from, to, this.canSeeCost(req), id);
  }

  @Get('stations/:id')
  @RequirePermissions('stations.view')
  @ApiOperation({ summary: 'Station cockpit: header, equipment, live occupancy, work-order queue' })
  detail(@Req() req: any, @Param('id') id: string) {
    return this.service.detail(id, this.canSeeCost(req));
  }

  @Get('lines/:lineId/stations')
  @RequirePermissions('stations.view')
  @ApiOperation({ summary: 'Stations for a line (legacy per-line list)' })
  findByLine(@Param('lineId') lineId: string) {
    return this.service.findByLine(lineId);
  }

  // ── Mutations ────────────────────────────────────────────────────────────────

  @Post('stations')
  @RequirePermissions('stations.manage')
  @ApiOperation({ summary: 'Create station' })
  create(@Body() dto: CreateStationDto) {
    return this.service.create(dto);
  }

  @Patch('stations/:id')
  @RequirePermissions('stations.manage')
  @ApiOperation({ summary: 'Update station (incl. re-parent to another line)' })
  update(@Param('id') id: string, @Body() dto: UpdateStationDto) {
    return this.service.update(id, dto);
  }

  @Patch('stations/:id/status')
  @RequirePermissions('stations.operate')
  @ApiOperation({ summary: 'Set the operational status (available/running/down/…)' })
  setStatus(@Param('id') id: string, @Body() dto: StationStatusDto) {
    return this.service.setStatus(id, dto.status);
  }

  @Delete('stations/:id')
  @RequirePermissions('stations.delete-station')
  @ApiOperation({ summary: 'Delete a station (refused with 409 if it has history — deactivate instead)' })
  remove(@Param('id') id: string) {
    return this.service.deleteStation(id);
  }
}
