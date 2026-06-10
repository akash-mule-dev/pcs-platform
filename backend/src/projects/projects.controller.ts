import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ProjectsService } from './projects.service.js';
import { CreateProjectDto } from './dto/create-project.dto.js';
import { UpdateProjectDto } from './dto/update-project.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/projects')
export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

  @Get()
  @ApiOperation({ summary: 'List projects' })
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get project by ID' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/nodes')
  @ApiOperation({ summary: 'List a project\'s assembly nodes (tree)' })
  findNodes(@Param('id') id: string) {
    return this.service.findNodes(id);
  }

  @Get(':id/nodes/:nodeId')
  @ApiOperation({ summary: 'Get one assembly node (dimensions, properties, model link)' })
  findNode(@Param('id') id: string, @Param('nodeId') nodeId: string) {
    return this.service.findNode(id, nodeId);
  }

  @Get(':id/nodes/:nodeId/meshes')
  @ApiOperation({ summary: 'GLB mesh names for a node + descendants (for 3D isolation)' })
  nodeMeshes(@Param('id') id: string, @Param('nodeId') nodeId: string) {
    return this.service.nodeMeshNames(id, nodeId);
  }

  @Post()
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Create project' })
  create(@Body() dto: CreateProjectDto) {
    return this.service.create(dto as any);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Update project' })
  update(@Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.service.update(id, dto as any);
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Delete project' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
