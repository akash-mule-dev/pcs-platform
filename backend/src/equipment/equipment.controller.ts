import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { EquipmentService } from './equipment.service.js';
import { CreateEquipmentDto, UpdateEquipmentDto, UpdateEquipmentStatusDto, OpenDowntimeDto, CloseDowntimeDto } from './dto/equipment.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

@ApiTags('Equipment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/equipment')
export class EquipmentController {
  constructor(private readonly service: EquipmentService) {}

  @Get() @RequirePermissions('equipment.view') findAll() { return this.service.findAll(); }

  @Get('effectiveness')
  @RequirePermissions('equipment.view')
  @ApiOperation({ summary: 'Real availability + MTBF/MTTR + downtime Pareto' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  effectiveness(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    return this.service.effectiveness(startDate, endDate);
  }

  @Get('downtime')
  @RequirePermissions('equipment.view')
  @ApiQuery({ name: 'equipmentId', required: false })
  downtime(@Query('equipmentId') equipmentId?: string) { return this.service.getDowntime(equipmentId); }

  @Get(':id') @RequirePermissions('equipment.view') findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Post() @RequirePermissions('equipment.manage') create(@Body() dto: CreateEquipmentDto) { return this.service.create(dto as any); }
  @Patch(':id') @RequirePermissions('equipment.manage') update(@Param('id') id: string, @Body() dto: UpdateEquipmentDto) { return this.service.update(id, dto as any); }
  @Delete(':id') @RequirePermissions('equipment.delete') remove(@Param('id') id: string) { return this.service.remove(id); }

  @Patch(':id/status')
  @RequirePermissions('equipment.operate')
  setStatus(@Param('id') id: string, @Body() dto: UpdateEquipmentStatusDto) { return this.service.setStatus(id, dto.status); }

  @Post(':id/downtime')
  @RequirePermissions('equipment.report-downtime')
  @ApiOperation({ summary: 'Record machine going down' })
  openDowntime(@Param('id') id: string, @Body() dto: OpenDowntimeDto) { return this.service.openDowntime(id, dto); }

  @Post(':id/downtime/close')
  @RequirePermissions('equipment.report-downtime')
  @ApiOperation({ summary: 'Close the open downtime event (machine back up)' })
  closeDowntime(@Param('id') id: string, @Body() dto: CloseDowntimeDto) { return this.service.closeDowntime(id, dto); }
}
