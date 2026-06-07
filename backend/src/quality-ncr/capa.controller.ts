import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { QualityNcrService } from './quality-ncr.service.js';
import { CreateCapaDto, UpdateCapaDto } from './dto/capa.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@ApiTags('CAPA')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/capa')
export class CapaController {
  constructor(private readonly service: QualityNcrService) {}

  @Get() @ApiQuery({ name: 'ncrId', required: false })
  list(@Query('ncrId') ncrId?: string) { return this.service.listCapa(ncrId); }

  @Post() @Roles('supervisor', 'manager', 'admin')
  @ApiOperation({ summary: 'Open a corrective/preventive action' })
  create(@Body() dto: CreateCapaDto) { return this.service.createCapa(dto); }

  @Patch(':id') @Roles('supervisor', 'manager', 'admin')
  update(@Param('id') id: string, @Body() dto: UpdateCapaDto) { return this.service.updateCapa(id, dto); }
}
