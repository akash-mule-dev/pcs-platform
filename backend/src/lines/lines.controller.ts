import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { LinesService } from './lines.service.js';
import { CreateLineDto } from './dto/create-line.dto.js';
import { UpdateLineDto } from './dto/update-line.dto.js';
import { PageOptionsDto } from '../common/dto/pagination.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

@ApiTags('Lines')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/lines')
export class LinesController {
  constructor(private readonly service: LinesService) {}

  @Get()
  @RequirePermissions('stations.view')
  @ApiOperation({ summary: 'List lines with stations' })
  findAll(@Query() pageOptions: PageOptionsDto) {
    return this.service.findAll(pageOptions);
  }

  @Get(':id')
  @RequirePermissions('stations.view')
  @ApiOperation({ summary: 'Get line by ID' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('stations.manage')
  @ApiOperation({ summary: 'Create line' })
  create(@Body() dto: CreateLineDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('stations.manage')
  @ApiOperation({ summary: 'Update line' })
  update(@Param('id') id: string, @Body() dto: UpdateLineDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('stations.delete')
  @ApiOperation({ summary: 'Delete line' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
