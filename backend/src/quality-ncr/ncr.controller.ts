import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { QualityNcrService } from './quality-ncr.service.js';
import { CreateNcrDto, UpdateNcrDto } from './dto/ncr.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

@ApiTags('NCR')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/ncr')
export class NcrController {
  constructor(private readonly service: QualityNcrService) {}

  @Get() @RequirePermissions('ncr.view') @ApiQuery({ name: 'status', required: false })
  list(@Query('status') status?: string) { return this.service.listNcr(status); }

  @Get(':id') @RequirePermissions('ncr.view') findOne(@Param('id') id: string) { return this.service.getNcr(id); }

  @Post()
  @RequirePermissions('ncr.create')
  @ApiOperation({ summary: 'Raise a non-conformance report (against a template)' })
  create(@Body() dto: CreateNcrDto) { return this.service.createNcr(dto); }

  @Patch(':id')
  @RequirePermissions('ncr.manage')
  @ApiOperation({ summary: 'Update / disposition / close an NCR' })
  update(@Param('id') id: string, @Body() dto: UpdateNcrDto) { return this.service.updateNcr(id, dto); }
}
