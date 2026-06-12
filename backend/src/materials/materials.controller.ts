import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { MaterialsService } from './materials.service.js';
import { CreateMaterialDto, UpdateMaterialDto } from './dto/material.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

@ApiTags('Materials')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/materials')
export class MaterialsController {
  constructor(private readonly service: MaterialsService) {}

  @Get()
  @RequirePermissions('materials.view')
  @ApiOperation({ summary: 'List materials' })
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @RequirePermissions('materials.view')
  @ApiOperation({ summary: 'Get a material' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('materials.manage')
  @ApiOperation({ summary: 'Create a material' })
  create(@Body() dto: CreateMaterialDto) {
    return this.service.create(dto as any);
  }

  @Patch(':id')
  @RequirePermissions('materials.manage')
  @ApiOperation({ summary: 'Update a material' })
  update(@Param('id') id: string, @Body() dto: UpdateMaterialDto) {
    return this.service.update(id, dto as any);
  }

  @Delete(':id')
  @RequirePermissions('materials.delete')
  @ApiOperation({ summary: 'Delete a material' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
