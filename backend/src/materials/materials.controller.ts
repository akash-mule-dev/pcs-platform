import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { MaterialsService } from './materials.service.js';
import { CreateMaterialDto, UpdateMaterialDto } from './dto/material.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@ApiTags('Materials')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/materials')
export class MaterialsController {
  constructor(private readonly service: MaterialsService) {}

  @Get()
  @ApiOperation({ summary: 'List materials' })
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a material' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Create a material' })
  create(@Body() dto: CreateMaterialDto) {
    return this.service.create(dto as any);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Update a material' })
  update(@Param('id') id: string, @Body() dto: UpdateMaterialDto) {
    return this.service.update(id, dto as any);
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Delete a material' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
