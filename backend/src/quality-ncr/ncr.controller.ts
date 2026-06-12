import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { QualityNcrService } from './quality-ncr.service.js';
import { CreateNcrDto, UpdateNcrDto, NcrFilterDto, NcrCommentDto } from './dto/ncr.dto.js';
import { ncrNextStatuses } from './ncr-workflow.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

@ApiTags('NCR')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/ncr')
export class NcrController {
  constructor(private readonly service: QualityNcrService) {}

  @Get()
  @RequirePermissions('ncr.view')
  @ApiOperation({ summary: 'List NCRs (filter by status/severity/project/item/work order/assignee/open/q)' })
  list(@Query() filter: NcrFilterDto) {
    return this.service.listNcr(filter);
  }

  @Get(':id')
  @RequirePermissions('ncr.view')
  @ApiOperation({ summary: 'An NCR with its legal next statuses (drives guided transition UIs)' })
  async findOne(@Param('id') id: string) {
    const ncr = await this.service.getNcr(id);
    return { ...ncr, allowedTransitions: ncrNextStatuses(ncr.status) };
  }

  @Get(':id/events')
  @RequirePermissions('ncr.view')
  @ApiOperation({ summary: 'NCR timeline: creation, transitions, dispositions, assignments, comments' })
  events(@Param('id') id: string) {
    return this.service.listEvents(id);
  }

  @Post(':id/comments')
  @RequirePermissions('ncr.create')
  @ApiOperation({ summary: 'Append a comment to the NCR timeline' })
  comment(@Param('id') id: string, @Body() dto: NcrCommentDto) {
    return this.service.addComment(id, dto.note);
  }

  @Post()
  @RequirePermissions('ncr.create')
  @ApiOperation({ summary: 'Raise a non-conformance report (against a template)' })
  create(@Body() dto: CreateNcrDto) {
    return this.service.createNcr(dto);
  }

  @Patch(':id')
  @RequirePermissions('ncr.manage')
  @ApiOperation({ summary: 'Update / transition / disposition / close an NCR (workflow-validated)' })
  update(@Param('id') id: string, @Body() dto: UpdateNcrDto) {
    return this.service.updateNcr(id, dto);
  }
}
