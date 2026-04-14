import { Controller, Get, Post } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public } from '../common/decorators/public.decorator.js';
import { SeedService } from '../seed/seed.service.js';

@ApiTags('Health')
@Controller('api/health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly seedService: SeedService,
  ) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Health check' })
  async check() {
    const dbOk = this.dataSource.isInitialized;
    let dbLatency = -1;

    try {
      const start = Date.now();
      await this.dataSource.query('SELECT 1');
      dbLatency = Date.now() - start;
    } catch {
      // DB query failed
    }

    return {
      status: dbOk ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: {
        connected: dbOk,
        latencyMs: dbLatency,
      },
      memory: {
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      },
    };
  }

  @Post('seed')
  @Public()
  @ApiOperation({ summary: 'Trigger database seed (force re-seed)' })
  async seed() {
    try {
      // Clear existing partial seed data so seed runs fully
      await this.dataSource.query('DELETE FROM "users" WHERE true');
      await this.dataSource.query('DELETE FROM "roles" WHERE true');
      await this.seedService.seed();
      const userCount = await this.dataSource.query('SELECT COUNT(*) FROM "users"');
      const roleCount = await this.dataSource.query('SELECT COUNT(*) FROM "roles"');
      return { status: 'seeded', users: userCount[0].count, roles: roleCount[0].count };
    } catch (err) {
      return { status: 'error', message: (err as Error).message, stack: (err as Error).stack?.split('\n').slice(0, 5) };
    }
  }

  @Get('ready')
  @Public()
  @ApiOperation({ summary: 'Readiness probe' })
  async ready() {
    const dbOk = this.dataSource.isInitialized;
    if (!dbOk) {
      return { status: 'not_ready' };
    }
    return { status: 'ready' };
  }
}
