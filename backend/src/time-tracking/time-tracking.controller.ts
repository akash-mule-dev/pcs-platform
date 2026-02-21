import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { TimeTrackingService } from './time-tracking.service.js';
import { ClockInDto } from './dto/clock-in.dto.js';
import { ClockOutDto } from './dto/clock-out.dto.js';
import { UpdateTimeEntryDto } from './dto/update-time-entry.dto.js';
import { PageOptionsDto } from '../common/dto/pagination.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@ApiTags('Time Tracking')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/time-tracking')
export class TimeTrackingController {
  constructor(private readonly service: TimeTrackingService) {}

  @Post('clock-in')
  @Roles('operator', 'supervisor', 'admin', 'manager')
  @ApiOperation({ summary: 'Clock in to a work order stage' })
  clockIn(@Request() req: any, @Body() dto: ClockInDto) {
    return this.service.clockIn(req.user.id, dto);
  }

  @Post('clock-out')
  @Roles('operator', 'supervisor', 'admin', 'manager')
  @ApiOperation({ summary: 'Clock out of active time entry' })
  clockOut(@Request() req: any, @Body() dto: ClockOutDto) {
    return this.service.clockOut(req.user.id, dto);
  }

  @Get('active')
  @ApiOperation({ summary: 'Get all active time entries' })
  getActive() {
    return this.service.getActive();
  }

  @Get('history')
  @ApiOperation({ summary: 'Get time entry history' })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'workOrderId', required: false })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  getHistory(
    @Query() pageOptions: PageOptionsDto,
    @Query('userId') userId?: string,
    @Query('workOrderId') workOrderId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.service.getHistory(pageOptions, userId, workOrderId, startDate, endDate);
  }

  @Get('user/:userId')
  @Roles('admin', 'manager', 'supervisor')
  @ApiOperation({ summary: 'Get time entries for user' })
  getByUser(@Param('userId') userId: string) {
    return this.service.getByUser(userId);
  }

  @Patch(':id')
  @Roles('admin', 'manager', 'supervisor')
  @ApiOperation({ summary: 'Correct a time entry' })
  update(@Param('id') id: string, @Body() dto: UpdateTimeEntryDto) {
    return this.service.update(id, dto);
  }
}
