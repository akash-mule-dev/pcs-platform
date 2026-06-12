import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ShiftsService } from './shifts.service.js';
import { RecordAttendanceDto } from './dto/workforce.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

@ApiTags('Attendance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/attendance')
export class AttendanceController {
  constructor(private readonly service: ShiftsService) {}

  @Get()
  @RequirePermissions('workforce.view')
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'date', required: false })
  list(@Query('userId') userId?: string, @Query('date') date?: string) {
    return this.service.listAttendance(userId, date);
  }

  @Post()
  @RequirePermissions('workforce.assign')
  @ApiOperation({ summary: 'Record/update an employee daily attendance' })
  record(@Body() dto: RecordAttendanceDto) { return this.service.recordAttendance(dto); }
}
