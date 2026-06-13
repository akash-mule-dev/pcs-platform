import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { SearchService } from './search.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolePermissionsResolver } from '../rbac/role-permissions.resolver.js';

@ApiTags('Search')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/search')
export class SearchController {
  constructor(
    private readonly service: SearchService,
    private readonly permissions: RolePermissionsResolver,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Global search (tenant-scoped; categories gated by caller permissions)' })
  @ApiQuery({ name: 'q', required: true })
  async search(@Query('q') query: string, @Request() req: any) {
    if (!query || query.trim().length < 2) return { workOrders: [], users: [] };
    const access = await this.permissions.resolveForUser(req.user);
    return this.service.search(query.trim(), { permissions: access.permissions });
  }
}
