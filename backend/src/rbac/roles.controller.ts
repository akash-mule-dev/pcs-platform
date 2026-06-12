import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from './guards/permissions.guard.js';
import { RequireAnyPermission, RequirePermissions } from '../common/decorators/require-permissions.decorator.js';
import { RolesService } from './roles.service.js';
import { CreateRoleDto, DuplicateRoleDto, UpdateRoleDto } from './dto/role.dto.js';

@ApiTags('Roles & Permissions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/rbac')
export class RolesController {
  constructor(private readonly service: RolesService) {}

  @Get('catalog')
  @RequirePermissions('roles.view')
  @ApiOperation({ summary: 'The fine-grained permission catalog (features × actions, grouped)' })
  catalog() {
    return this.service.catalog();
  }

  @Get('roles')
  @RequirePermissions('roles.view')
  @ApiOperation({ summary: 'System + this organization’s custom roles, with permissions and user counts' })
  list() {
    return this.service.list();
  }

  @Get('roles/assignable')
  @RequireAnyPermission('roles.view', 'users.view', 'users.create', 'users.update')
  @ApiOperation({ summary: 'Lightweight role list for assignment dropdowns' })
  assignable() {
    return this.service.assignable();
  }

  @Get('roles/:id')
  @RequirePermissions('roles.view')
  @ApiOperation({ summary: 'One role with its permission set' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Post('roles')
  @RequirePermissions('roles.create')
  @ApiOperation({ summary: 'Create a custom role with fine-grained permissions' })
  create(@Body() dto: CreateRoleDto) {
    return this.service.create(dto);
  }

  @Post('roles/:id/duplicate')
  @RequirePermissions('roles.create')
  @ApiOperation({ summary: 'Duplicate a role (incl. system roles) into an editable custom role' })
  duplicate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DuplicateRoleDto) {
    return this.service.duplicate(id, dto);
  }

  @Patch('roles/:id')
  @RequirePermissions('roles.update')
  @ApiOperation({ summary: 'Update a custom role (name, description, permissions)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto) {
    return this.service.update(id, dto);
  }

  @Delete('roles/:id')
  @RequirePermissions('roles.delete')
  @ApiOperation({ summary: 'Delete a custom role (blocked while users are assigned)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
