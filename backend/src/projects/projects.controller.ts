import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ProjectsService } from './projects.service.js';
import { ProjectProgressService } from './project-progress.service.js';
import { CreateProjectDto } from './dto/create-project.dto.js';
import { UpdateProjectDto } from './dto/update-project.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/projects')
export class ProjectsController {
  constructor(
    private readonly service: ProjectsService,
    private readonly progressService: ProjectProgressService,
  ) {}

  @Get()
  @RequirePermissions('projects.view')
  @ApiOperation({ summary: 'List projects' })
  findAll() {
    return this.service.findAll();
  }

  // NOTE: must precede `@Get(':id')` so the literal path isn't matched as an id.
  @Get('summary')
  @RequirePermissions('projects.view')
  @ApiOperation({ summary: 'List projects with production rollup (portfolio dashboard)' })
  findAllWithMetrics() {
    return this.service.findAllWithMetrics();
  }

  // NOTE: must precede `@Get(':id')` so the literal path isn't matched as an id.
  @Get('deleted')
  @RequirePermissions('projects.view')
  @ApiOperation({ summary: 'List soft-deleted (recoverable) projects — the Trash' })
  listDeleted() {
    return this.service.listDeleted();
  }

  @Get(':id')
  @RequirePermissions('projects.view')
  @ApiOperation({ summary: 'Get project by ID' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/nodes')
  @RequirePermissions('projects.view')
  @ApiOperation({ summary: 'List a project\'s assembly nodes (tree)' })
  findNodes(@Param('id') id: string) {
    return this.service.findNodes(id);
  }

  @Get(':id/nodes/:nodeId')
  @RequirePermissions('projects.view')
  @ApiOperation({ summary: 'Get one assembly node (dimensions, properties, model link)' })
  findNode(@Param('id') id: string, @Param('nodeId') nodeId: string) {
    return this.service.findNode(id, nodeId);
  }

  @Get(':id/progress')
  @RequirePermissions('projects.view')
  @ApiOperation({ summary: 'Design summary: node composition, total tonnage, work-order item count' })
  progress(@Param('id') id: string) {
    return this.progressService.getProgress(id);
  }

  @Get(':id/nodes/:nodeId/meshes')
  @RequirePermissions('projects.view')
  @ApiOperation({ summary: 'GLB mesh names for a node + descendants (for 3D isolation)' })
  nodeMeshes(@Param('id') id: string, @Param('nodeId') nodeId: string) {
    return this.service.nodeMeshNames(id, nodeId);
  }

  @Post()
  @RequirePermissions('projects.create')
  @ApiOperation({ summary: 'Create project' })
  create(@Body() dto: CreateProjectDto) {
    return this.service.create(dto as any);
  }

  @Patch(':id')
  @RequirePermissions('projects.update')
  @ApiOperation({ summary: 'Update project' })
  update(@Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.service.update(id, dto as any);
  }

  @Delete(':id')
  @RequirePermissions('projects.delete')
  @ApiOperation({ summary: 'Delete project (soft — recoverable from the Trash for 30 days)' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post(':id/restore')
  @RequirePermissions('projects.delete')
  @ApiOperation({ summary: 'Restore a soft-deleted project from the Trash' })
  restore(@Param('id') id: string) {
    return this.service.restore(id);
  }

  @Delete(':id/purge')
  @RequirePermissions('projects.delete')
  @ApiOperation({ summary: 'Permanently delete a project now (whole subtree + files) — irreversible' })
  purge(@Param('id') id: string) {
    return this.service.purge(id);
  }
}
