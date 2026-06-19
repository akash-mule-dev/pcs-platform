import {
  Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, Request, Res,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';
import { SupportService } from './support.service.js';
import { ReplyDto, UpdateTicketDto } from './dto/support.dto.js';
import { supportAttachmentContentType } from './support-attachments.constants.js';
import { supportAttachmentMulter, streamToResponse } from './support-upload.js';

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

  @Get('agents')
  @RequirePermissions('support-desk.view')
  @ApiOperation({ summary: 'Support staff a ticket can be assigned to' })
  agents() {
    return this.service.listAgents();
  }

  @Get('organizations')
  @RequirePermissions('support-desk.view')
  @ApiOperation({ summary: 'Tenants that have raised tickets (per-company filter)' })
  organizations() {
    return this.service.listTicketOrganizations();
  }

  @Get('tickets')
  @RequirePermissions('support-desk.view')
  @ApiOperation({ summary: 'List support tickets across all tenants' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'priority', required: false })
  @ApiQuery({ name: 'organizationId', required: false })
  @ApiQuery({ name: 'assignedToUserId', required: false })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  list(
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('organizationId') organizationId?: string,
    @Query('assignedToUserId') assignedToUserId?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.listAll({ status, priority, organizationId, assignedToUserId, q, limit: limit ? +limit : undefined, offset: offset ? +offset : undefined });
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

  @Post('tickets/:id/attachments')
  @RequirePermissions('support-desk.manage')
  @ApiOperation({ summary: 'Reply (or add an internal note) with a file attachment' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', supportAttachmentMulter))
  addAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('body') body: string | undefined,
    @Body('internal') internal: string | undefined,
    @Request() req: any,
  ) {
    return this.service.addSupportAttachment(id, file, body, internal === 'true' || internal === '1', { id: req.user.id, email: req.user.email });
  }

  @Get('tickets/:id/messages/:messageId/attachments/:index')
  @RequirePermissions('support-desk.view')
  @ApiOperation({ summary: 'Stream a message attachment (incl. internal notes)' })
  async getAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Param('index', ParseIntPipe) index: number,
    @Res() res: Response,
  ) {
    try {
      const { stream, key } = await this.service.getDeskAttachmentStream(id, messageId, index);
      streamToResponse(stream, res, supportAttachmentContentType(key));
    } catch {
      return res.status(404).json({ message: 'Attachment not found' });
    }
  }
}
