import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';
import { SupportService } from './support.service.js';
import { CreateTicketDto, ReplyDto } from './dto/support.dto.js';

/**
 * Customer-facing support — a tenant's own users raise and follow tickets.
 * Scoped to the caller's organization; internal support notes are never
 * returned here.
 */
@ApiTags('Support')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/support')
export class SupportController {
  constructor(private readonly service: SupportService) {}

  @Get('meta')
  @RequirePermissions('support.view')
  @ApiOperation({ summary: 'Status / priority / category option lists' })
  meta() {
    return this.service.meta();
  }

  @Get('tickets')
  @RequirePermissions('support.view')
  @ApiOperation({ summary: "List this company's support tickets" })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'q', required: false })
  list(@Query('status') status?: string, @Query('q') q?: string) {
    return this.service.listMine({ status, q });
  }

  @Get('tickets/:id')
  @RequirePermissions('support.view')
  @ApiOperation({ summary: 'A ticket with its public conversation' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getMine(id);
  }

  @Post('tickets')
  @RequirePermissions('support.create')
  @ApiOperation({ summary: 'Raise a new support ticket' })
  create(@Body() dto: CreateTicketDto, @Request() req: any) {
    return this.service.createTicket(dto, { id: req.user.id, email: req.user.email });
  }

  @Post('tickets/:id/messages')
  @RequirePermissions('support.comment')
  @ApiOperation({ summary: 'Reply on a ticket (reopens it if it was waiting/closed)' })
  reply(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplyDto, @Request() req: any) {
    return this.service.replyMine(id, dto, { id: req.user.id, email: req.user.email });
  }

  @Post('tickets/:id/close')
  @RequirePermissions('support.comment')
  @ApiOperation({ summary: 'Close your own ticket' })
  close(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.service.closeMine(id, { id: req.user.id, email: req.user.email });
  }
}
