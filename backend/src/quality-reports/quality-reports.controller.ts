import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { QualityReportsService } from './quality-reports.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

@ApiTags('Quality Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/quality-reports')
export class QualityReportsController {
  constructor(private readonly service: QualityReportsService) {}

  @Get()
  @RequirePermissions('quality-reports.view')
  @ApiOperation({ summary: 'List QC reports (filter by work order / project / status)' })
  @ApiQuery({ name: 'productionOrderId', required: false })
  @ApiQuery({ name: 'projectId', required: false })
  @ApiQuery({ name: 'status', required: false })
  list(
    @Query('productionOrderId') productionOrderId?: string,
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
  ) {
    return this.service.list({ productionOrderId, projectId, status });
  }

  @Get(':id')
  @RequirePermissions('quality-reports.view')
  @ApiOperation({ summary: 'A report with its template-schema snapshot and filled data' })
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post()
  @RequirePermissions('quality-reports.create')
  @ApiOperation({ summary: 'Start a BLANK report from a template against a work order' })
  create(@Body() body: { templateId?: string; productionOrderId?: string; assemblyNodeId?: string }) {
    if (!body?.templateId) throw new BadRequestException('templateId is required');
    if (!body?.productionOrderId) throw new BadRequestException('productionOrderId is required');
    return this.service.create({
      templateId: body.templateId,
      productionOrderId: body.productionOrderId,
      assemblyNodeId: body.assemblyNodeId,
    });
  }

  @Post('from-inspection')
  @RequirePermissions('quality-reports.create')
  @ApiOperation({ summary: 'Raise an NCR from a failed inspection (pre-filled + linked to the quality_data row)' })
  fromInspection(
    @Body() body: { qualityDataId?: string; templateId?: string; productionOrderId?: string; assemblyNodeId?: string },
  ) {
    if (!body?.qualityDataId) throw new BadRequestException('qualityDataId is required');
    if (!body?.templateId) throw new BadRequestException('templateId is required');
    if (!body?.productionOrderId) throw new BadRequestException('productionOrderId is required');
    return this.service.createFromInspection({
      qualityDataId: body.qualityDataId,
      templateId: body.templateId,
      productionOrderId: body.productionOrderId,
      assemblyNodeId: body.assemblyNodeId,
    });
  }

  @Patch(':id')
  @RequirePermissions('quality-reports.update')
  @ApiOperation({ summary: 'Save filled values (draft) or submit the report' })
  update(@Param('id') id: string, @Body() body: { data?: Record<string, any>; status?: string }) {
    return this.service.update(id, body ?? {});
  }

  @Get(':id/events')
  @RequirePermissions('quality-reports.view')
  @ApiOperation({ summary: 'NCR activity timeline (raise / disposition / comments / close …)' })
  events(@Param('id') id: string) {
    return this.service.events(id);
  }

  @Post(':id/comment')
  @RequirePermissions('quality-reports.update')
  @ApiOperation({ summary: 'Add a comment to an NCR activity log' })
  comment(@Param('id') id: string, @Body() body: { note?: string }) {
    if (!body?.note?.trim()) throw new BadRequestException('note is required');
    return this.service.addComment(id, body.note);
  }

  @Post(':id/start-review')
  @RequirePermissions('quality-reports.update')
  @ApiOperation({ summary: 'Move an open NCR into "under review"' })
  startReview(@Param('id') id: string, @Body() body: { note?: string }) {
    return this.service.startReview(id, body?.note);
  }

  @Post(':id/disposition')
  @RequirePermissions('quality-reports.disposition')
  @ApiOperation({ summary: 'Record the Material-Review disposition (rework/repair/use-as-is/scrap/return)' })
  disposition(
    @Param('id') id: string,
    @Body() body: { disposition?: string; dispositionNotes?: string; rootCause?: string; correctiveAction?: string; concessionReason?: string },
  ) {
    if (!body?.disposition) throw new BadRequestException('disposition is required');
    return this.service.recordDisposition(id, {
      disposition: body.disposition,
      dispositionNotes: body.dispositionNotes,
      rootCause: body.rootCause,
      correctiveAction: body.correctiveAction,
      concessionReason: body.concessionReason,
    });
  }

  @Post(':id/resolve')
  @RequirePermissions('quality-reports.disposition')
  @ApiOperation({ summary: 'Close an NCR — needs a disposition (and a passing rework re-inspection); lifts gates' })
  resolve(@Param('id') id: string) {
    return this.service.resolve(id);
  }

  @Post(':id/reopen')
  @RequirePermissions('quality-reports.disposition')
  @ApiOperation({ summary: 'Reopen a closed NCR (re-blocks its gates)' })
  reopen(@Param('id') id: string) {
    return this.service.reopen(id);
  }

  @Post(':id/cancel')
  @RequirePermissions('quality-reports.disposition')
  @ApiOperation({ summary: 'Cancel an NCR raised in error (lifts gates; recorded as voided)' })
  cancel(@Param('id') id: string, @Body() body: { note?: string }) {
    return this.service.cancel(id, body?.note);
  }

  @Delete(':id')
  @RequirePermissions('quality-reports.delete')
  @ApiOperation({ summary: 'Delete a report' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
