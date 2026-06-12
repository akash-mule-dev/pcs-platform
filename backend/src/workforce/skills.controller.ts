import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SkillsService } from './skills.service.js';
import { CreateSkillDto, UpdateSkillDto, AssignSkillDto } from './dto/workforce.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

@ApiTags('Skills')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/skills')
export class SkillsController {
  constructor(private readonly service: SkillsService) {}

  @Get() @RequirePermissions('workforce.view') list() { return this.service.findAll(); }
  @Post() @RequirePermissions('workforce.manage') create(@Body() dto: CreateSkillDto) { return this.service.create(dto as any); }

  @Post('assign')
  @RequirePermissions('workforce.assign')
  @ApiOperation({ summary: 'Grant/update a skill or certification for an employee' })
  assign(@Body() dto: AssignSkillDto) { return this.service.assignSkill(dto); }

  @Get('user/:userId')
  @RequirePermissions('workforce.view')
  @ApiOperation({ summary: "List an employee's skills/certifications" })
  userSkills(@Param('userId') userId: string) { return this.service.listUserSkills(userId); }

  @Delete('assignments/:id')
  @RequirePermissions('workforce.assign')
  removeAssignment(@Param('id') id: string) { return this.service.removeEmployeeSkill(id); }

  @Patch(':id') @RequirePermissions('workforce.manage') update(@Param('id') id: string, @Body() dto: UpdateSkillDto) { return this.service.update(id, dto as any); }
  @Delete(':id') @RequirePermissions('workforce.manage') remove(@Param('id') id: string) { return this.service.remove(id); }
}
