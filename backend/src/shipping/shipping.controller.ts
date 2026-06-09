import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ShippingService } from './shipping.service.js';
import { CreateShipmentDto } from './dto/create-shipment.dto.js';
import { AddShipmentItemDto } from './dto/add-shipment-item.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@ApiTags('Shipping')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/shipments')
export class ShippingController {
  constructor(private readonly service: ShippingService) {}

  @Get()
  @ApiOperation({ summary: 'List shipments (optionally filtered by project)' })
  findAll(@Query('projectId') projectId?: string) {
    return projectId ? this.service.findByProject(projectId) : this.service.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get shipment by ID' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Create shipment' })
  create(@Body() dto: CreateShipmentDto) {
    return this.service.create(dto as any);
  }

  @Post(':id/items')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Add an assembly to a shipment' })
  addItem(@Param('id') id: string, @Body() dto: AddShipmentItemDto) {
    return this.service.addItem(id, dto);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Update shipment' })
  update(@Param('id') id: string, @Body() dto: Partial<CreateShipmentDto>) {
    return this.service.update(id, dto as any);
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Delete shipment' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
