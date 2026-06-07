import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ShiftsService } from './shifts.service.js';
import { RecordAttendanceDto } from './dto/workforce.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@ApiTags('Attendance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/attendance')
export class AttendanceController {
  constructor(private readonly service: ShiftsService) {}

  @Get()
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'date', required: false })
  list(@Query('userId') userId?: string, @Query('date') date?: string) {
    return this.service.listAttendance(userId, date);
  }

  @Post()
  @Roles('admin', 'manager', 'supervisor')
  @ApiOperation({ summary: 'Record/update an employee daily attendance' })
  record(@Body() dto: RecordAttendanceDto) { return this.service.recordAttendance(dto); }
}
