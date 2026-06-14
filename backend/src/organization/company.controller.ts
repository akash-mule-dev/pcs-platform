import {
  Body, Controller, Delete, Get, Patch, Post, Res,
  UseGuards, UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrganizationService } from './organization.service.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';
import { logoContentType, LOGO_MAX_BYTES } from './logo.constants.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

/**
 * Tenant-facing company profile — every organization's own admins/managers can
 * view and edit THEIR company's details. Scoped to the caller's org via tenant
 * context (no id in the path), distinct from the platform `/api/organizations`
 * provisioning API.
 */
@ApiTags('Company')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/company')
export class CompanyController {
  constructor(private readonly service: OrganizationService) {}

  @Get()
  @RequirePermissions('company.view')
  @ApiOperation({ summary: "Get the caller's own company profile" })
  getOwn() {
    return this.service.getOwn();
  }

  @Patch()
  @RequirePermissions('company.manage')
  @ApiOperation({ summary: "Update the caller's own company profile (name, description, contact/address)" })
  updateOwn(@Body() dto: UpdateCompanyDto) {
    return this.service.updateOwn(dto);
  }

  @Get('logo')
  @RequirePermissions('company.view')
  @ApiOperation({ summary: "Stream the caller's own company logo" })
  async getLogo(@Res() res: Response) {
    try {
      const { stream, key } = await this.service.getOwnLogoStream();
      res.set({
        'Content-Type': logoContentType(key),
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      });
      (stream as any).pipe(res);
    } catch {
      res.status(404).json({ message: 'Logo not found' });
    }
  }

  @Post('logo')
  @RequirePermissions('company.manage')
  @ApiOperation({ summary: "Upload/replace the caller's own company logo (PNG, JPEG, WebP or SVG, ≤5 MB)" })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: LOGO_MAX_BYTES } }))
  uploadLogo(@UploadedFile() file: Express.Multer.File) {
    return this.service.setOwnLogo(file);
  }

  @Delete('logo')
  @RequirePermissions('company.manage')
  @ApiOperation({ summary: "Remove the caller's own company logo" })
  removeLogo() {
    return this.service.removeOwnLogo();
  }
}
