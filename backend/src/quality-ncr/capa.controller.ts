import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { QualityNcrService } from './quality-ncr.service.js';
import { CreateCapaDto, UpdateCapaDto } from './dto/capa.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

@ApiTags('CAPA')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/capa')
export class CapaController {
  constructor(private readonly service: QualityNcrService) {}

  @Get() @RequirePermissions('ncr.view') @ApiQuery({ name: 'ncrId', required: false })
  list(@Query('ncrId') ncrId?: string) { return this.service.listCapa(ncrId); }

  @Post() @RequirePermissions('ncr.manage')
  @ApiOperation({ summary: 'Open a corrective/preventive action' })
  create(@Body() dto: CreateCapaDto) { return this.service.createCapa(dto); }

  @Patch(':id') @RequirePermissions('ncr.manage')
  update(@Param('id') id: string, @Body() dto: UpdateCapaDto) { return this.service.updateCapa(id, dto); }
}
