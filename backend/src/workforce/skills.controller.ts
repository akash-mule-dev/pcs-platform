import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SkillsService } from './skills.service.js';
import { CreateSkillDto, UpdateSkillDto, AssignSkillDto } from './dto/workforce.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@ApiTags('Skills')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/skills')
export class SkillsController {
  constructor(private readonly service: SkillsService) {}

  @Get() list() { return this.service.findAll(); }
  @Post() @Roles('admin', 'manager') create(@Body() dto: CreateSkillDto) { return this.service.create(dto as any); }

  @Post('assign')
  @Roles('admin', 'manager', 'supervisor')
  @ApiOperation({ summary: 'Grant/update a skill or certification for an employee' })
  assign(@Body() dto: AssignSkillDto) { return this.service.assignSkill(dto); }

  @Get('user/:userId')
  @ApiOperation({ summary: "List an employee's skills/certifications" })
  userSkills(@Param('userId') userId: string) { return this.service.listUserSkills(userId); }

  @Delete('assignments/:id')
  @Roles('admin', 'manager', 'supervisor')
  removeAssignment(@Param('id') id: string) { return this.service.removeEmployeeSkill(id); }

  @Patch(':id') @Roles('admin', 'manager') update(@Param('id') id: string, @Body() dto: UpdateSkillDto) { return this.service.update(id, dto as any); }
  @Delete(':id') @Roles('admin', 'manager') remove(@Param('id') id: string) { return this.service.remove(id); }
}
