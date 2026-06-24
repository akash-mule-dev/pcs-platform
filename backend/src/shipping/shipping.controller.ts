import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ShippingService } from './shipping.service.js';
import { ShipmentStatus } from './shipment.entity.js';
import { CreateShipmentDto } from './dto/create-shipment.dto.js';
import { AddShipmentItemDto } from './dto/add-shipment-item.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

@ApiTags('Shipping')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/shipments')
export class ShippingController {
  constructor(private readonly service: ShippingService) {}

  @Get()
  @RequirePermissions('shipping.view')
  @ApiOperation({ summary: 'List shipments (filter by work order via orderId, or by project)' })
  findAll(@Query('orderId') orderId?: string, @Query('projectId') projectId?: string) {
    if (orderId) return this.service.findByOrder(orderId);
    if (projectId) return this.service.findByProject(projectId);
    return this.service.findAll();
  }

  @Get('board')
  @RequirePermissions('shipping.view')
  @ApiOperation({ summary: "Ship board for one work order: each assembly's complete / shipped / allocated / available units" })
  shipBoard(@Query('orderId') orderId: string) {
    if (!orderId) throw new BadRequestException('orderId is required');
    return this.service.shipBoard(orderId);
  }

  @Get(':id/delivery-note')
  @RequirePermissions('shipping.view')
  @ApiOperation({ summary: 'Delivery note / packing slip data (header, itemized assemblies, totals, optional heat numbers) — the web renders it as a printable PDF' })
  deliveryNote(@Param('id') id: string, @Query('heats') heats?: string) {
    return this.service.deliveryNote(id, heats !== 'false');
  }

  @Get(':id/qc-package')
  @RequirePermissions('quality-reports.view')
  @ApiOperation({ summary: 'QC sign-off dossier: delivery header + MTR rollup + inspections + NCRs + filled reports + releasability summary for the shipped scope (web renders to PDF)' })
  qcPackage(@Param('id') id: string) {
    return this.service.qcPackage(id);
  }

  @Get(':id')
  @RequirePermissions('shipping.view')
  @ApiOperation({ summary: 'Get shipment by ID' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('shipping.manage')
  @ApiOperation({ summary: 'Create shipment' })
  create(@Body() dto: CreateShipmentDto) {
    return this.service.create(dto as any);
  }

  @Post(':id/items')
  @RequirePermissions('shipping.manage')
  @ApiOperation({ summary: 'Add an assembly to a shipment' })
  addItem(@Param('id') id: string, @Body() dto: AddShipmentItemDto) {
    return this.service.addItem(id, dto);
  }

  @Delete(':id/items/:itemId')
  @RequirePermissions('shipping.manage')
  @ApiOperation({ summary: 'Remove an assembly from a shipment' })
  removeItem(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.service.removeItem(id, itemId);
  }

  @Patch(':id/status')
  @RequirePermissions('shipping.manage')
  @ApiOperation({ summary: 'Set shipment status (shipping advances the assemblies)' })
  setStatus(@Param('id') id: string, @Body() body: { status?: ShipmentStatus }) {
    if (!body?.status) throw new BadRequestException('status is required');
    return this.service.setStatus(id, body.status);
  }

  @Patch(':id')
  @RequirePermissions('shipping.manage')
  @ApiOperation({ summary: 'Update shipment' })
  update(@Param('id') id: string, @Body() dto: Partial<CreateShipmentDto>) {
    return this.service.update(id, dto as any);
  }

  @Delete(':id')
  @RequirePermissions('shipping.delete')
  @ApiOperation({ summary: 'Delete shipment' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
