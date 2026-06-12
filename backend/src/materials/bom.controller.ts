import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { MaterialsService } from './materials.service.js';
import { CreateBomItemDto, UpdateBomItemDto } from './dto/bom.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

@ApiTags('BOM')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/bom')
export class BomController {
  constructor(private readonly service: MaterialsService) {}

  @Get()
  @RequirePermissions('materials.view')
  @ApiOperation({ summary: 'Get the bill of materials for a product' })
  @ApiQuery({ name: 'productId', required: true })
  getBom(@Query('productId') productId: string) {
    return this.service.getBom(productId);
  }

  @Post()
  @RequirePermissions('materials.manage')
  @ApiOperation({ summary: 'Add a BOM line' })
  add(@Body() dto: CreateBomItemDto) {
    return this.service.addBomItem(dto);
  }

  @Patch(':id')
  @RequirePermissions('materials.manage')
  @ApiOperation({ summary: 'Update a BOM line' })
  update(@Param('id') id: string, @Body() dto: UpdateBomItemDto) {
    return this.service.updateBomItem(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('materials.manage')
  @ApiOperation({ summary: 'Remove a BOM line' })
  remove(@Param('id') id: string) {
    return this.service.removeBomItem(id);
  }
}
