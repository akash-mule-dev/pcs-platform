import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ProjectModelService } from './project-model.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { Public } from '../common/decorators/public.decorator.js';

@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/projects')
export class ProjectModelController {
  constructor(private readonly modelService: ProjectModelService) {}

  @Get(':id/nodes/:nodeId/glb')
  @Public()
  @ApiOperation({
    summary:
      'Isolated GLB for one node — streams only that part/assembly’s geometry (public, like /models/:id/file)',
  })
  async nodePartGlb(
    @Param('id') id: string,
    @Param('nodeId') nodeId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { data, isolated, meshCount, fileName } = await this.modelService.getNodePartGlb(id, nodeId);
    res.set({
      'Content-Type': 'model/gltf-binary',
      'Content-Disposition': `inline; filename="${fileName}"`,
      'Content-Length': String(data.length),
      'X-Part-Isolated': String(isolated),
      'X-Part-Mesh-Count': String(meshCount),
      'Access-Control-Expose-Headers': 'Content-Disposition, X-Part-Isolated, X-Part-Mesh-Count',
      'Cache-Control': 'private, max-age=300',
    });
    res.end(data);
  }
}
