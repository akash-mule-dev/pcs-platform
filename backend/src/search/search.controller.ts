import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { SearchService } from './search.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

@ApiTags('Search')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/search')
export class SearchController {
  constructor(private readonly service: SearchService) {}

  @Get()
  @ApiOperation({ summary: 'Global search across work orders, products, users' })
  @ApiQuery({ name: 'q', required: true })
  search(@Query('q') query: string) {
    if (!query || query.trim().length < 2) return { workOrders: [], products: [], users: [] };
    return this.service.search(query.trim());
  }
}
