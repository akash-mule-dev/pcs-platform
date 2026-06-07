import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { RbacService } from './rbac.service.js';
import { UpsertPermissionDto } from './dto/rbac.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@ApiTags('RBAC')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/rbac')
export class RbacController {
  constructor(private readonly service: RbacService) {}

  @Get('permissions') @Roles('admin', 'manager') list() { return this.service.list(); }

  @Post('permissions')
  @Roles('admin')
  @ApiOperation({ summary: 'Set a role/feature permission override for this tenant' })
  upsert(@Body() dto: UpsertPermissionDto) { return this.service.upsert(dto); }

  @Delete('permissions/:id') @Roles('admin') remove(@Param('id') id: string) { return this.service.remove(id); }

  @Get('resolve')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Effective permissions for a role (defaults + overrides)' })
  @ApiQuery({ name: 'role', required: true })
  resolve(@Query('role') role: string) { return this.service.resolveForRole(role); }
}
