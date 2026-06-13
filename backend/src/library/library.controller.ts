import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';
import { LibraryService } from './library.service.js';
import { PublishDto } from './dto/publish.dto.js';

/**
 * Shared-library admin API — platform operators only (the `library` feature is
 * platform-scoped, so tenant admins can neither see nor call these).
 */
@ApiTags('Shared Library')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/library')
export class LibraryController {
  constructor(private readonly service: LibraryService) {}

  @Get('summary')
  @RequirePermissions('library.view')
  @ApiOperation({ summary: 'Library organization + content counts' })
  summary() {
    return this.service.summary();
  }

  @Get('processes')
  @RequirePermissions('library.view')
  @ApiOperation({ summary: 'List library master processes (with stages)' })
  processes() {
    return this.service.listProcesses();
  }

  @Get('templates')
  @RequirePermissions('library.view')
  @ApiOperation({ summary: 'List library master form templates' })
  templates() {
    return this.service.listTemplates();
  }

  @Post('processes/:id/publish')
  @RequirePermissions('library.publish')
  @ApiOperation({ summary: 'Publish a library process into one tenant or all tenants (idempotent)' })
  publishProcess(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PublishDto) {
    return dto.allTenants
      ? this.service.publishProcessToAllTenants(id)
      : this.service.publishProcessToOrg(id, dto.organizationId!);
  }

  @Post('templates/:id/publish')
  @RequirePermissions('library.publish')
  @ApiOperation({ summary: 'Publish a library template into one tenant or all tenants (idempotent)' })
  publishTemplate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PublishDto) {
    return dto.allTenants
      ? this.service.publishTemplateToAllTenants(id)
      : this.service.publishTemplateToOrg(id, dto.organizationId!);
  }
}
