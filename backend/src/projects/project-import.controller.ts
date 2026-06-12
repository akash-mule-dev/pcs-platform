import { Controller, Get, Post, Param, Req, UploadedFile, UseInterceptors, UseGuards, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
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
