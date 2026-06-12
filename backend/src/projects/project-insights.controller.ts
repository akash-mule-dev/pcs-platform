import {
  Controller, Get, Post, Delete, Param, Query, Body, Req, Res,
  UploadedFile, UseInterceptors, UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes, ApiQuery } from '@nestjs/swagger';
import { ProjectInsightsService } from './project-insights.service.js';
import { ProjectDocumentService } from './project-document.service.js';
import { ProjectTraceabilityService } from './project-traceability.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

/**
 * Project intelligence + per-piece extras:
 * BOM/stock, earned-value, shop drawings per node, heat-number traceability.
 */
@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/projects')
export class ProjectInsightsController {
  constructor(
    private readonly insights: ProjectInsightsService,
    private readonly documents: ProjectDocumentService,
    private readonly traceability: ProjectTraceabilityService,
  ) {}

  // ── Earned value (BOM/material requirements: material-planning.controller) ──
  @Get(':id/earned-value')
  @RequirePermissions('projects.view')
  @ApiOperation({ summary: 'Progress billing: weekly produced + shipped tonnage with cumulative earned %' })
  @ApiQuery({ name: 'orderId', required: false })
  earnedValue(@Param('id') id: string, @Query('orderId') orderId?: string) {
    return this.insights.earnedValue(id, orderId || undefined);
  }

  // ── Shop drawings / documents per node ──
  @Get(':id/nodes/:nodeId/documents')
  @RequirePermissions('projects.view')
  @ApiOperation({ summary: 'Documents attached to an assembly node (shop drawings, weld maps…)' })
  listDocuments(@Param('id') id: string, @Param('nodeId') nodeId: string) {
    return this.documents.list(id, nodeId);
  }

  @Post(':id/nodes/:nodeId/documents')
  @RequirePermissions('projects.update')
  @ApiOperation({ summary: 'Attach a document (PDF/PNG/JPEG/WebP ≤ 20 MB) to an assembly node' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  uploadDocument(
    @Param('id') id: string,
    @Param('nodeId') nodeId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('label') label: string | undefined,
    @Req() req: any,
  ) {
    return this.documents.upload(id, nodeId, file, label, req?.user);
  }

  @Get(':id/documents/:docId/file')
  @RequirePermissions('projects.view')
  @ApiOperation({ summary: 'Stream a node document (authed)' })
  async openDocument(@Param('id') id: string, @Param('docId') docId: string, @Res() res: Response) {
    const { doc, stream } = await this.documents.open(id, docId);
    res.setHeader('Content-Type', doc.contentType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.originalName)}"`);
    (stream as NodeJS.ReadableStream).pipe(res);
  }

  @Delete(':id/documents/:docId')
  @RequirePermissions('projects.update')
  @ApiOperation({ summary: 'Remove a node document' })
  removeDocument(@Param('id') id: string, @Param('docId') docId: string) {
    return this.documents.remove(id, docId);
  }

  // ── Heat-number traceability ──
  @Get(':id/lots')
  @RequirePermissions('projects.view')
  @ApiOperation({ summary: 'Material lots available to assign (search by lot/heat/supplier/material)' })
  @ApiQuery({ name: 'q', required: false })
  availableLots(@Param('id') _id: string, @Query('q') q?: string) {
    return this.traceability.availableLots(q || undefined);
  }

  @Get(':id/nodes/:nodeId/lots')
  @RequirePermissions('projects.view')
  @ApiOperation({ summary: 'Heat numbers / lots assigned to an assembly node' })
  nodeLots(@Param('id') id: string, @Param('nodeId') nodeId: string) {
    return this.traceability.listForNode(id, nodeId);
  }

  @Post(':id/nodes/:nodeId/lots')
  @RequirePermissions('projects.update')
  @ApiOperation({ summary: 'Assign a material lot (heat #) to a piece' })
  assignLot(
    @Param('id') id: string,
    @Param('nodeId') nodeId: string,
    @Body() body: { materialLotId: string; quantity?: number; note?: string },
    @Req() req: any,
  ) {
    return this.traceability.assign(id, nodeId, body, req?.user);
  }

  @Delete(':id/lot-assignments/:assignmentId')
  @RequirePermissions('projects.update')
  @ApiOperation({ summary: 'Remove a lot assignment' })
  unassignLot(@Param('id') id: string, @Param('assignmentId') assignmentId: string) {
    return this.traceability.unassign(id, assignmentId);
  }

  @Get(':id/shipments/:shipmentId/traceability')
  @RequirePermissions('projects.view')
  @ApiOperation({ summary: 'MTR rollup for a shipment: heat numbers + certs per item (incl. descendants), with coverage gaps' })
  shipmentTraceability(@Param('id') id: string, @Param('shipmentId') shipmentId: string) {
    return this.traceability.shipmentTraceability(id, shipmentId);
  }
}
