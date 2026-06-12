import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ProcessesService } from './processes.service.js';
import { CreateProcessDto } from './dto/create-process.dto.js';
import { UpdateProcessDto } from './dto/update-process.dto.js';
import { PageOptionsDto } from '../common/dto/pagination.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

@ApiTags('Processes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/processes')
export class ProcessesController {
  constructor(private readonly service: ProcessesService) {}

  @Get()
  @RequirePermissions('processes.view')
  @ApiOperation({ summary: 'List processes' })
  findAll(@Query() pageOptions: PageOptionsDto) {
    return this.service.findAll(pageOptions);
  }

  @Get(':id')
  @RequirePermissions('processes.view')
  @ApiOperation({ summary: 'Get process with stages' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post('standard')
  @RequirePermissions('processes.create')
  @ApiOperation({ summary: 'Get-or-create the "Standard Fabrication" process (Cut → Fit → Weld → QC → Paint)' })
  ensureStandard() {
    return this.service.ensureStandard();
  }

  @Post()
  @RequirePermissions('processes.create')
  @ApiOperation({ summary: 'Create process' })
  create(@Body() dto: CreateProcessDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('processes.update')
  @ApiOperation({ summary: 'Update process' })
  update(@Param('id') id: string, @Body() dto: UpdateProcessDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('processes.delete')
  @ApiOperation({ summary: 'Delete process' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
