import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { TraceabilityService } from './traceability.service.js';
import { CreateMaterialLotDto, CreateSerialDto, UpdateSerialDto, LinkGenealogyDto } from './dto/traceability.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

@ApiTags('Traceability')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/traceability')
export class TraceabilityController {
  constructor(private readonly service: TraceabilityService) {}

  @Get('lots') @RequirePermissions('traceability.view') @ApiQuery({ name: 'materialId', required: false })
  listLots(@Query('materialId') materialId?: string) { return this.service.listLots(materialId); }
  @Post('lots') @RequirePermissions('traceability.record')
  @ApiOperation({ summary: 'Record a received material lot (heat/cert)' })
  createLot(@Body() dto: CreateMaterialLotDto) { return this.service.createLot(dto); }

  @Get('serials') @RequirePermissions('traceability.view') @ApiQuery({ name: 'workOrderId', required: false })
  listSerials(@Query('workOrderId') workOrderId?: string) { return this.service.listSerials(workOrderId); }
  @Post('serials') @RequirePermissions('traceability.record')
  createSerial(@Body() dto: CreateSerialDto) { return this.service.createSerial(dto); }
  @Patch('serials/:id') @RequirePermissions('traceability.record')
  updateSerial(@Param('id') id: string, @Body() dto: UpdateSerialDto) { return this.service.updateSerial(id, dto); }

  @Post('genealogy') @RequirePermissions('traceability.record')
  @ApiOperation({ summary: 'Link a material lot consumed into a finished serial' })
  link(@Body() dto: LinkGenealogyDto) { return this.service.link(dto); }

  @Get('genealogy/:serialId')
  @RequirePermissions('traceability.view')
  @ApiOperation({ summary: 'Forward trace: what a unit was built from' })
  genealogy(@Param('serialId') serialId: string) { return this.service.getGenealogy(serialId); }

  @Get('where-used/:lotId')
  @RequirePermissions('traceability.view')
  @ApiOperation({ summary: 'Recall trace: which units used a lot' })
  whereUsed(@Param('lotId') lotId: string) { return this.service.whereUsed(lotId); }
}
