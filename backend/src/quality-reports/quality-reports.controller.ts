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

  @Patch(':id')
  @RequirePermissions('quality-reports.update')
  @ApiOperation({ summary: 'Save filled values (draft) or submit the report' })
  update(@Param('id') id: string, @Body() body: { data?: Record<string, any>; status?: string }) {
    return this.service.update(id, body ?? {});
  }

  @Delete(':id')
  @RequirePermissions('quality-reports.delete')
  @ApiOperation({ summary: 'Delete a report' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
