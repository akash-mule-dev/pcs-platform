import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { StationsService } from './stations.service.js';
import { CreateStationDto } from './dto/create-station.dto.js';
import { UpdateStationDto } from './dto/update-station.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

@ApiTags('Stations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api')
export class StationsController {
  constructor(private readonly service: StationsService) {}

  @Get('lines/:lineId/stations')
  @RequirePermissions('stations.view')
  @ApiOperation({ summary: 'Get stations for a line' })
  findByLine(@Param('lineId') lineId: string) {
    return this.service.findByLine(lineId);
  }

  @Post('stations')
  @RequirePermissions('stations.manage')
  @ApiOperation({ summary: 'Create station' })
  create(@Body() dto: CreateStationDto) {
    return this.service.create(dto);
  }

  @Patch('stations/:id')
  @RequirePermissions('stations.manage')
  @ApiOperation({ summary: 'Update station' })
  update(@Param('id') id: string, @Body() dto: UpdateStationDto) {
    return this.service.update(id, dto);
  }

  @Delete('stations/:id')
  @RequirePermissions('stations.manage')
  @ApiOperation({ summary: 'Delete station' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
