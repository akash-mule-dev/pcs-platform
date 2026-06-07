import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { EquipmentService } from './equipment.service.js';
import { CreateEquipmentDto, UpdateEquipmentDto, UpdateEquipmentStatusDto, OpenDowntimeDto, CloseDowntimeDto } from './dto/equipment.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@ApiTags('Equipment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/equipment')
export class EquipmentController {
  constructor(private readonly service: EquipmentService) {}

  @Get() findAll() { return this.service.findAll(); }

  @Get('effectiveness')
  @ApiOperation({ summary: 'Real availability + MTBF/MTTR + downtime Pareto' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  effectiveness(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    return this.service.effectiveness(startDate, endDate);
  }

  @Get('downtime')
  @ApiQuery({ name: 'equipmentId', required: false })
  downtime(@Query('equipmentId') equipmentId?: string) { return this.service.getDowntime(equipmentId); }

  @Get(':id') findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Post() @Roles('admin', 'manager') create(@Body() dto: CreateEquipmentDto) { return this.service.create(dto as any); }
  @Patch(':id') @Roles('admin', 'manager') update(@Param('id') id: string, @Body() dto: UpdateEquipmentDto) { return this.service.update(id, dto as any); }
  @Delete(':id') @Roles('admin') remove(@Param('id') id: string) { return this.service.remove(id); }

  @Patch(':id/status')
  @Roles('admin', 'manager', 'supervisor')
  setStatus(@Param('id') id: string, @Body() dto: UpdateEquipmentStatusDto) { return this.service.setStatus(id, dto.status); }

  @Post(':id/downtime')
  @Roles('admin', 'manager', 'supervisor', 'operator')
  @ApiOperation({ summary: 'Record machine going down' })
  openDowntime(@Param('id') id: string, @Body() dto: OpenDowntimeDto) { return this.service.openDowntime(id, dto); }

  @Post(':id/downtime/close')
  @Roles('admin', 'manager', 'supervisor', 'operator')
  @ApiOperation({ summary: 'Close the open downtime event (machine back up)' })
  closeDowntime(@Param('id') id: string, @Body() dto: CloseDowntimeDto) { return this.service.closeDowntime(id, dto); }
}
