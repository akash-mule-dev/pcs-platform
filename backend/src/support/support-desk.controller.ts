import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';
import { SupportService } from './support.service.js';
import { ReplyDto, UpdateTicketDto } from './dto/support.dto.js';

/**
 * Platform support desk — cross-tenant triage for platform operators only
 * (`support-desk` is platform-scoped, so tenant admins can't reach it).
 */
@ApiTags('Support Desk')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/support-desk')
export class SupportDeskController {
  constructor(private readonly service: SupportService) {}

  @Get('meta')
  @RequirePermissions('support-desk.view')
  @ApiOperation({ summary: 'Status / priority / category option lists' })
  meta() {
    return this.service.meta();
  }

  @Get('stats')
  @RequirePermissions('support-desk.view')
  @ApiOperation({ summary: 'Ticket counts by status (desk header)' })
  stats() {
    return this.service.stats();
  }

  @Get('tickets')
  @RequirePermissions('support-desk.view')
  @ApiOperation({ summary: 'List support tickets across all tenants' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'priority', required: false })
  @ApiQuery({ name: 'organizationId', required: false })
  @ApiQuery({ name: 'assignedToUserId', required: false })
  @ApiQuery({ name: 'q', required: false })
  list(
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('organizationId') organizationId?: string,
    @Query('assignedToUserId') assignedToUserId?: string,
    @Query('q') q?: string,
  ) {
    return this.service.listAll({ status, priority, organizationId, assignedToUserId, q });
  }

  @Get('tickets/:id')
  @RequirePermissions('support-desk.view')
  @ApiOperation({ summary: 'A ticket with the full thread (incl. internal notes)' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getAny(id);
  }

  @Post('tickets/:id/messages')
  @RequirePermissions('support-desk.manage')
  @ApiOperation({ summary: 'Reply to the customer or add an internal note' })
  reply(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplyDto, @Request() req: any) {
    return this.service.replySupport(id, dto, { id: req.user.id, email: req.user.email });
  }

  @Patch('tickets/:id')
  @RequirePermissions('support-desk.manage')
  @ApiOperation({ summary: 'Triage: status / priority / assignment' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTicketDto, @Request() req: any) {
    return this.service.update(id, dto, { id: req.user.id, email: req.user.email });
  }
}
