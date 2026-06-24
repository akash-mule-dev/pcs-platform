import { Controller, Get, Headers, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AlertsService } from './alerts.service.js';

/**
 * Internal, UNAUTHENTICATED (no JWT/RBAC) cron entrypoints for the operational
 * alert sweeps — invoked by Vercel Cron, the only reliable scheduler on a
 * serverless deploy. On Vercel the in-process `@Cron` jobs in AlertsService are
 * NOT registered (ScheduleModule is loaded only on always-on hosts — see
 * app.module.ts): a never-`unref`'d cron timer keeps the Fluid instance's event
 * loop alive 24/7 and pins Provisioned Memory. These endpoints call the EXACT
 * same AlertsService methods, so the behaviour is identical to in-process dev —
 * just triggered by Vercel Cron instead of an in-process timer.
 *
 * Access is gated by a shared secret: the request must carry
 * `Authorization: Bearer <CRON_SECRET>` (Vercel Cron auto-attaches this when a
 * `CRON_SECRET` env var is set). Fails CLOSED — if `CRON_SECRET` is unset every
 * endpoint is disabled. Mirrors ProjectCronController.
 *
 * Schedules: the Vercel free/Hobby plan caps Cron at 2 jobs / daily granularity,
 * so these sub-daily sweeps are triggered by GitHub Actions instead — see
 * `.github/workflows/scheduled-jobs.yml` (the daily retention purge stays a
 * native Vercel Cron in `backend/vercel.json`). On an always-on host the
 * in-process @Cron jobs in AlertsService fire and these endpoints go unused.
 */
@ApiExcludeController()
@Controller('api/internal/alerts')
export class AlertsCronController {
  private readonly logger = new Logger(AlertsCronController.name);

  constructor(private readonly alerts: AlertsService) {}

  @Get('overdue-work-orders')
  async overdueWorkOrders(@Headers('authorization') auth?: string): Promise<{ ok: true }> {
    this.authorize(auth);
    await this.alerts.checkOverdueWorkOrders();
    return { ok: true };
  }

  @Get('idle-stations')
  async idleStations(@Headers('authorization') auth?: string): Promise<{ ok: true }> {
    this.authorize(auth);
    await this.alerts.checkIdleStations();
    return { ok: true };
  }

  @Get('overdue-ncrs')
  async overdueNcrs(@Headers('authorization') auth?: string): Promise<{ ok: true }> {
    this.authorize(auth);
    await this.alerts.checkOverdueNcrs();
    return { ok: true };
  }

  @Get('shift-summary')
  async shiftSummary(@Headers('authorization') auth?: string): Promise<{ ok: true }> {
    this.authorize(auth);
    await this.alerts.generateShiftSummary();
    return { ok: true };
  }

  /** Shared-secret gate; fails CLOSED when CRON_SECRET is unset. */
  private authorize(auth?: string): void {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      this.logger.warn('Alert cron endpoint hit but CRON_SECRET is not set — refusing.');
      throw new ServiceUnavailableException('Alert crons are not configured');
    }
    if (auth !== `Bearer ${secret}`) throw new UnauthorizedException();
  }
}
