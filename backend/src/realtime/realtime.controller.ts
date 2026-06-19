import { Controller, Get, Post, UseGuards, Req, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AblyService } from './ably.service.js';

/**
 * Real-time transport endpoints.
 *
 * - GET  /realtime/config — public; tells the client which transport this
 *   server is running ('ably' | 'socketio') so it connects the right way with
 *   no per-environment frontend build.
 * - POST /realtime/token  — JWT-guarded; the web/mobile Ably SDK calls this as
 *   its auth callback. Returns a server-signed token request scoped to the
 *   caller's own channels (see AblyService.createTokenRequest). The Ably API
 *   key never leaves the server.
 */
@Controller('realtime')
export class RealtimeController {
  constructor(private readonly ably: AblyService) {}

  @Get('config')
  config(): { driver: 'ably' | 'socketio' } {
    return { driver: this.ably.enabled ? 'ably' : 'socketio' };
  }

  @UseGuards(JwtAuthGuard)
  @Post('token')
  async token(@Req() req: any): Promise<unknown> {
    if (!this.ably.enabled) {
      throw new BadRequestException('Real-time (Ably) is not enabled on this server');
    }
    const user = req.user ?? {};
    return this.ably.createTokenRequest({
      userId: user.id ?? user.userId ?? user.sub,
      organizationId: user.organizationId ?? null,
    });
  }
}
