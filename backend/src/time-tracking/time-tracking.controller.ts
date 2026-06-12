import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { TimeTrackingService } from './time-tracking.service.js';
import { ClockInDto } from './dto/clock-in.dto.js';
import { ClockOutDto } from './dto/clock-out.dto.js';
import { UpdateTimeEntryDto } from './dto/update-time-entry.dto.js';
import { PageOptionsDto } from '../common/dto/pagination.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

@ApiTags('Time Tracking')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/time-tracking')
export class TimeTrackingController {
  constructor(private readonly service: TimeTrackingService) {}

  @Post('clock-in')
  @RequirePermissions('time-tracking.track')
  @ApiOperation({ summary: 'Clock in to a work order stage' })
  clockIn(@Request() req: any, @Body() dto: ClockInDto) {
    return this.service.clockIn(req.user.id, dto);
  }

  @Post('clock-out')
  @RequirePermissions('time-tracking.track')
  @ApiOperation({ summary: 'Clock out of active time entry' })
  clockOut(@Request() req: any, @Body() dto: ClockOutDto) {
    return this.service.clockOut(req.user.id, dto);
  }

  @Get('active')
  @RequirePermissions('time-tracking.view')
  @ApiOperation({ summary: 'Get all active time entries' })
  getActive() {
    return this.service.getActive();
  }

  @Get('history')
  @RequirePermissions('time-tracking.view')
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
  @RequirePermissions('time-tracking.manage')
  @ApiOperation({ summary: 'Get time entries for user' })
  getByUser(@Param('userId') userId: string) {
    return this.service.getByUser(userId);
  }

  @Patch(':id')
  @RequirePermissions('time-tracking.manage')
  @ApiOperation({ summary: 'Correct a time entry' })
  update(@Param('id') id: string, @Body() dto: UpdateTimeEntryDto) {
    return this.service.update(id, dto);
  }
}
