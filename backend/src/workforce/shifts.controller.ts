import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ShiftsService } from './shifts.service.js';
import { CreateShiftDto, UpdateShiftDto, AssignShiftDto } from './dto/workforce.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

@ApiTags('Shifts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/shifts')
export class ShiftsController {
  constructor(private readonly service: ShiftsService) {}

  @Get() @RequirePermissions('workforce.view') listShifts() { return this.service.listShifts(); }

  @Get('assignments')
  @RequirePermissions('workforce.view')
  @ApiQuery({ name: 'userId', required: false })
  listAssignments(@Query('userId') userId?: string) { return this.service.listAssignments(userId); }

  @Post() @RequirePermissions('workforce.manage') create(@Body() dto: CreateShiftDto) { return this.service.createShift(dto); }

  @Post('assign')
  @RequirePermissions('workforce.assign')
  @ApiOperation({ summary: 'Assign an employee to a shift' })
  assign(@Body() dto: AssignShiftDto) { return this.service.assignShift(dto); }

  @Delete('assignments/:id') @RequirePermissions('workforce.assign') removeAssignment(@Param('id') id: string) { return this.service.removeAssignment(id); }

  @Patch(':id') @RequirePermissions('workforce.manage') update(@Param('id') id: string, @Body() dto: UpdateShiftDto) { return this.service.updateShift(id, dto); }
  @Delete(':id') @RequirePermissions('workforce.manage') remove(@Param('id') id: string) { return this.service.removeShift(id); }
}
