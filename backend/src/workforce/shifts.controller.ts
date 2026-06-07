import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ShiftsService } from './shifts.service.js';
import { CreateShiftDto, UpdateShiftDto, AssignShiftDto } from './dto/workforce.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@ApiTags('Shifts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/shifts')
export class ShiftsController {
  constructor(private readonly service: ShiftsService) {}

  @Get() listShifts() { return this.service.listShifts(); }

  @Get('assignments')
  @ApiQuery({ name: 'userId', required: false })
  listAssignments(@Query('userId') userId?: string) { return this.service.listAssignments(userId); }

  @Post() @Roles('admin', 'manager') create(@Body() dto: CreateShiftDto) { return this.service.createShift(dto); }

  @Post('assign')
  @Roles('admin', 'manager', 'supervisor')
  @ApiOperation({ summary: 'Assign an employee to a shift' })
  assign(@Body() dto: AssignShiftDto) { return this.service.assignShift(dto); }

  @Delete('assignments/:id') @Roles('admin', 'manager', 'supervisor') removeAssignment(@Param('id') id: string) { return this.service.removeAssignment(id); }

  @Patch(':id') @Roles('admin', 'manager') update(@Param('id') id: string, @Body() dto: UpdateShiftDto) { return this.service.updateShift(id, dto); }
  @Delete(':id') @Roles('admin', 'manager') remove(@Param('id') id: string) { return this.service.removeShift(id); }
}
