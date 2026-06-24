import { Controller, Get, Headers, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ProjectPurgeService } from './project-purge.service.js';

/**
 * Internal, UNAUTHENTICATED (no JWT/RBAC) cron entrypoint for the retention
 * purge — invoked by Vercel Cron, the only reliable scheduler on a serverless
 * deploy where the in-process `@Cron` can't be trusted to fire. Access is gated
 * by a shared secret: the request must carry `Authorization: Bearer <CRON_SECRET>`
 * (Vercel Cron auto-attaches this when a `CRON_SECRET` env var is set). Fails
 * CLOSED — if `CRON_SECRET` is unset the endpoint is disabled.
 *
 * Schedule it in `backend/vercel.json`:
 *   "crons": [{ "path": "/api/internal/projects/purge-expired", "schedule": "0 3 * * *" }]
 */
@ApiExcludeController()
@Controller('api/internal/projects')
export class ProjectCronController {
  private readonly logger = new Logger(ProjectCronController.name);

  constructor(private readonly purgeService: ProjectPurgeService) {}

  @Get('purge-expired')
  async purgeExpired(@Headers('authorization') auth?: string): Promise<{ purged: number }> {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      this.logger.warn('Retention purge endpoint hit but CRON_SECRET is not set — refusing.');
      throw new ServiceUnavailableException('Retention purge is not configured');
    }
    if (auth !== `Bearer ${secret}`) throw new UnauthorizedException();
    const purged = await this.purgeService.purgeExpired();
    return { purged };
  }
}
