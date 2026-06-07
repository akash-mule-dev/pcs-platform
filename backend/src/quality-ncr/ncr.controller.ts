import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { QualityNcrService } from './quality-ncr.service.js';
import { CreateNcrDto, UpdateNcrDto } from './dto/ncr.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@ApiTags('NCR')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/ncr')
export class NcrController {
  constructor(private readonly service: QualityNcrService) {}

  @Get() @ApiQuery({ name: 'status', required: false })
  list(@Query('status') status?: string) { return this.service.listNcr(status); }

  @Get(':id') findOne(@Param('id') id: string) { return this.service.getNcr(id); }

  @Post()
  @Roles('operator', 'supervisor', 'manager', 'admin')
  @ApiOperation({ summary: 'Raise a non-conformance report (against a template)' })
  create(@Body() dto: CreateNcrDto) { return this.service.createNcr(dto); }

  @Patch(':id')
  @Roles('supervisor', 'manager', 'admin')
  @ApiOperation({ summary: 'Update / disposition / close an NCR' })
  update(@Param('id') id: string, @Body() dto: UpdateNcrDto) { return this.service.updateNcr(id, dto); }
}
