import { Controller, Post, Param, UploadedFile, UseInterceptors, UseGuards, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { IfcImportService } from './ifc-import.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/projects')
export class ProjectImportController {
  constructor(private readonly importService: IfcImportService) {}

  @Post(':id/import-ifc')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Upload an IFC file and extract its assembly tree into the project' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async importIfc(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    const data = file.buffer ?? (file.path ? await import('fs').then((fs) => fs.readFileSync(file.path)) : null);
    if (!data) throw new BadRequestException('Uploaded file could not be read');
    return this.importService.importIfc(id, file.originalname, data);
  }

  @Post(':id/resolve-models')
  @Roles('admin', 'manager', 'supervisor')
  @ApiOperation({ summary: 'Link GLBs produced by queued conversions back to the project tree' })
  resolveModels(@Param('id') id: string) {
    return this.importService.linkPendingModels(id);
  }
}
