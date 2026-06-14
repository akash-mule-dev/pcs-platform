import { Controller, Get, Post, Param, Req, Res, UploadedFile, UseInterceptors, UseGuards, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import type { Response } from 'express';
import { IfcImportService } from './ifc-import.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/projects')
export class ProjectImportController {
  constructor(private readonly importService: IfcImportService) {}

  @Post(':id/import-ifc')
  @RequirePermissions('projects.import')
  @ApiOperation({ summary: 'Upload an IFC: stored durably first, then processed asynchronously (follow progress via GET :id/imports + the import:progress websocket event)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async importIfc(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @Req() req: any) {
    if (!file) throw new BadRequestException('No file uploaded');
    const data = file.buffer ?? (file.path ? await import('fs').then((fs) => fs.readFileSync(file.path)) : null);
    if (!data) throw new BadRequestException('Uploaded file could not be read');
    return this.importService.startImport(id, file.originalname, data, req?.user);
  }

  @Get(':id/imports')
  @RequirePermissions('projects.view')
  @ApiOperation({ summary: 'Import pipeline monitoring: every upload with its live stage/progress and final status, newest first' })
  listImports(@Param('id') id: string) {
    return this.importService.listImports(id);
  }

  @Get(':id/imports/:importId')
  @RequirePermissions('projects.view')
  @ApiOperation({ summary: 'One import with its full event timeline and conversion-job snapshot' })
  getImport(@Param('id') id: string, @Param('importId') importId: string) {
    return this.importService.getImportDetail(id, importId);
  }

  @Get(':id/imports/:importId/revision')
  @RequirePermissions('projects.view')
  @ApiOperation({ summary: 'Revision diff of this import (added/changed/missing vs the prior tree) + production impact per affected piece' })
  getRevision(@Param('id') id: string, @Param('importId') importId: string) {
    return this.importService.getImportRevision(id, importId);
  }

  @Get(':id/imports/:importId/source')
  @RequirePermissions('projects.view')
  @ApiOperation({ summary: 'Download the original uploaded package/source file of this import (streamed from durable storage)' })
  async downloadSource(@Param('id') id: string, @Param('importId') importId: string, @Res() res: Response) {
    try {
      const { importFile, stream } = await this.importService.getImportSource(id, importId);
      const safeName = (importFile.originalName || 'package').replace(/["\r\n]/g, '_');
      res.set({
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${safeName}"`,
        'Access-Control-Expose-Headers': 'Content-Disposition',
        ...(importFile.size ? { 'Content-Length': String(importFile.size) } : {}),
      });
      (stream as any).pipe(res);
    } catch (err: any) {
      res.status(404).json({ message: err?.message || 'Original package not available' });
    }
  }

  @Post(':id/imports/:importId/retry')
  @RequirePermissions('projects.import')
  @ApiOperation({ summary: 'Retry a failed import (conversion-only when the structure already extracted, otherwise the full pipeline from the stored source)' })
  retryImport(@Param('id') id: string, @Param('importId') importId: string) {
    return this.importService.retryImport(id, importId);
  }

  @Post(':id/resolve-models')
  @RequirePermissions('projects.view')
  @ApiOperation({ summary: 'Link GLBs produced by queued conversions back to the project tree (healing path)' })
  resolveModels(@Param('id') id: string) {
    return this.importService.linkPendingModels(id);
  }
}
