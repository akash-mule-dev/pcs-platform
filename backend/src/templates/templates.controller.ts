import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { TemplatesService } from './templates.service.js';
import { CreateTemplateDto, UpdateTemplateDto } from './dto/template.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@ApiTags('Form Templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/templates')
export class TemplatesController {
  constructor(private readonly service: TemplatesService) {}

  @Get() @ApiQuery({ name: 'type', required: false })
  list(@Query('type') type?: string) { return this.service.listByType(type); }

  @Get(':id') findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Post() @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Create a configurable form/report template' })
  create(@Body() dto: CreateTemplateDto) { return this.service.create(dto as any); }

  @Patch(':id') @Roles('admin', 'manager') update(@Param('id') id: string, @Body() dto: UpdateTemplateDto) { return this.service.update(id, dto as any); }
  @Delete(':id') @Roles('admin', 'manager') remove(@Param('id') id: string) { return this.service.remove(id); }
}
