import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ProcessesService } from './processes.service.js';
import { CreateProcessDto } from './dto/create-process.dto.js';
import { UpdateProcessDto } from './dto/update-process.dto.js';
import { PageOptionsDto } from '../common/dto/pagination.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@ApiTags('Processes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/processes')
export class ProcessesController {
  constructor(private readonly service: ProcessesService) {}

  @Get()
  @ApiOperation({ summary: 'List processes' })
  findAll(@Query() pageOptions: PageOptionsDto) {
    return this.service.findAll(pageOptions);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get process with stages' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Create process' })
  create(@Body() dto: CreateProcessDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Update process' })
  update(@Param('id') id: string, @Body() dto: UpdateProcessDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Delete process' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
