import {
  Controller, Get, Post, Patch, Body, Param, ParseUUIDPipe, Request, Res,
  UseGuards, UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { OrganizationService } from './organization.service.js';
import { CreateOrganizationDto } from './dto/create-organization.dto.js';
import { UpdateOrganizationDto } from './dto/update-organization.dto.js';
import { logoContentType, LOGO_MAX_BYTES } from './logo.constants.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

/** Shared multipart options for logo uploads — in-memory (buffer → object store, never disk). */
const LOGO_UPLOAD = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: LOGO_MAX_BYTES },
});

/** Platform-level tenant provisioning, restricted to platform permissions. */
@ApiTags('Organizations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/organizations')
export class OrganizationController {
  constructor(private readonly service: OrganizationService) {}

  @Get()
  @RequirePermissions('organizations.view')
  @ApiOperation({ summary: 'List organizations (platform)' })
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @RequirePermissions('organizations.view')
  @ApiOperation({ summary: 'Get an organization' })
  findOne(@Param('id') id: string) {
    return this.service.findOnePublic(id);
  }

  @Get(':id/logo')
  @RequirePermissions('organizations.view')
  @ApiOperation({ summary: "Stream a tenant's logo image" })
  async getLogo(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    try {
      const { stream, key } = await this.service.getLogoStream(id);
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

  @Post(':id/logo')
  @RequirePermissions('organizations.manage')
  @ApiOperation({ summary: "Upload/replace a tenant's logo (PNG, JPEG, WebP or SVG, ≤5 MB)" })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  @UseInterceptors(LOGO_UPLOAD)
  uploadLogo(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File) {
    return this.service.setLogo(id, file);
  }

  @Post()
  @RequirePermissions('organizations.manage')
  @ApiOperation({ summary: 'Provision a new tenant organization' })
  create(@Body() dto: CreateOrganizationDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('organizations.manage')
  @ApiOperation({ summary: 'Update an organization' })
  update(@Param('id') id: string, @Body() dto: UpdateOrganizationDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/impersonate')
  @RequirePermissions('organizations.impersonate')
  @ApiOperation({ summary: 'Start a time-limited support session inside a tenant (returns a scoped token)' })
  impersonate(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.service.impersonate(id, { id: req.user.id, email: req.user.email, employeeId: req.user.employeeId });
  }
}
