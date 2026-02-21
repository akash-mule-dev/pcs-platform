import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { LinesService } from './lines.service.js';
import { CreateLineDto } from './dto/create-line.dto.js';
import { UpdateLineDto } from './dto/update-line.dto.js';
import { PageOptionsDto } from '../common/dto/pagination.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@ApiTags('Lines')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/lines')
export class LinesController {
  constructor(private readonly service: LinesService) {}

  @Get()
  @ApiOperation({ summary: 'List lines with stations' })
  findAll(@Query() pageOptions: PageOptionsDto) {
    return this.service.findAll(pageOptions);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get line by ID' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Create line' })
  create(@Body() dto: CreateLineDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Update line' })
  update(@Param('id') id: string, @Body() dto: UpdateLineDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Delete line' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
