import { Controller, Get, Post, UseGuards, Req, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AblyService } from './ably.service.js';

/**
 * Real-time transport endpoints.
 *
 * - GET  /api/realtime/config — public; tells the client which transport this
 *   server is running ('ably' | 'socketio') so it connects the right way with
 *   no per-environment frontend build.
 * - POST /api/realtime/token  — JWT-guarded; the web/mobile Ably SDK calls this
 *   as its auth callback. Returns a server-signed token request scoped to the
 *   caller's own channels (see AblyService.createTokenRequest). The Ably API
 *   key never leaves the server.
 *
 * NOTE: the route prefix is `api/` because this app sets NO global prefix — every
 * controller hardcodes `api/...` in its @Controller() path. The web + mobile
 * clients call `${apiUrl}/realtime/config` where apiUrl already ends in `/api`,
 * so the controller MUST be `api/realtime` to match. (It was `realtime` once,
 * which 404'd at `/api/realtime/config` and silently forced clients onto the
 * Socket.IO fallback — fatal on serverless, which can't hold a WebSocket.)
 */
@Controller('api/realtime')
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
