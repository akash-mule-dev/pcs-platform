import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { TemplatesService } from './templates.service.js';
import { CreateTemplateDto, UpdateTemplateDto } from './dto/template.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

@ApiTags('Form Templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/templates')
export class TemplatesController {
  constructor(private readonly service: TemplatesService) {}

  @Get() @RequirePermissions('templates.view') @ApiQuery({ name: 'type', required: false })
  list(@Query('type') type?: string) { return this.service.listByType(type); }

  @Get(':id') @RequirePermissions('templates.view') findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Post() @RequirePermissions('templates.manage')
  @ApiOperation({ summary: 'Create a configurable form/report template' })
  create(@Body() dto: CreateTemplateDto) { return this.service.create(dto as any); }

  @Patch(':id') @RequirePermissions('templates.manage') update(@Param('id') id: string, @Body() dto: UpdateTemplateDto) { return this.service.update(id, dto as any); }
  @Delete(':id') @RequirePermissions('templates.manage') remove(@Param('id') id: string) { return this.service.remove(id); }
}
