import { Controller, Get, Post } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public } from '../common/decorators/public.decorator.js';
import { SeedService } from '../seed/seed.service.js';
import * as bcrypt from 'bcryptjs';

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
    const log: string[] = [];
    try {
      const beforeRoles = await this.dataSource.query('SELECT COUNT(*) as cnt FROM "roles"');
      log.push(`before: ${beforeRoles[0].cnt} roles`);
      const beforeUsers = await this.dataSource.query('SELECT COUNT(*) as cnt FROM "users"');
      log.push(`before: ${beforeUsers[0].cnt} users`);

      if (Number(beforeUsers[0].cnt) > 0) {
        await this.dataSource.query('DELETE FROM "users"');
        log.push('deleted users');
      }
      if (Number(beforeRoles[0].cnt) > 0) {
        await this.dataSource.query('DELETE FROM "roles"');
        log.push('deleted roles');
      }

      // Test bcryptjs
      const hash = await bcrypt.hash('password123', 10);
      log.push(`bcrypt hash: ${hash ? hash.substring(0, 20) + '...' : 'null'}`);

      // Try direct SQL insert as fallback
      try {
        await this.dataSource.query(`INSERT INTO "roles" (name, description) VALUES ('admin', 'admin role') ON CONFLICT DO NOTHING`);
        log.push('direct role insert ok');
        const roleResult = await this.dataSource.query(`SELECT id FROM "roles" WHERE name = 'admin'`);
        const roleId = roleResult[0]?.id;
        log.push(`admin role id: ${roleId}`);
        if (roleId) {
          await this.dataSource.query(
            `INSERT INTO "users" ("employeeId", email, "passwordHash", "firstName", "lastName", "roleId") VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
            ['EMP-001', 'admin@pcs.com', hash, 'Rajesh', 'Patil', roleId],
          );
          log.push('direct user insert ok');
        }
      } catch (sqlErr) {
        log.push(`direct insert error: ${(sqlErr as Error).message}`);
      }

      await this.seedService.seed();
      log.push('seed() completed');

      const afterRoles = await this.dataSource.query('SELECT COUNT(*) as cnt FROM "roles"');
      const afterUsers = await this.dataSource.query('SELECT COUNT(*) as cnt FROM "users"');
      log.push(`after: ${afterRoles[0].cnt} roles, ${afterUsers[0].cnt} users`);

      return { status: 'seeded', log };
    } catch (err) {
      log.push(`error: ${(err as Error).message}`);
      return { status: 'error', log, stack: (err as Error).stack?.split('\n').slice(0, 5) };
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
