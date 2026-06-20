import { Injectable, Logger } from '@nestjs/common';
import { Rest } from 'ably';

/**
 * Thin wrapper around the Ably REST client.
 *
 * The backend NEVER holds a WebSocket of its own — it publishes events over
 * plain outbound HTTPS (which works fine on Vercel serverless functions) and
 * Ably's hosted edge fans them out to subscribed web/mobile clients. This is
 * what makes real-time work in production, where the in-process Socket.IO
 * server can't survive (serverless functions are torn down between requests).
 *
 * Driver selection:
 *   - REALTIME_DRIVER=ably|socketio   — explicit override, OR
 *   - 'ably' when ABLY_API_KEY is present, else 'socketio' (local dev default).
 *
 * When disabled, the EventsGateway falls back to its in-process Socket.IO
 * server (local dev, or any always-on host that calls app.listen()).
 */
@Injectable()
export class AblyService {
  private readonly logger = new Logger(AblyService.name);
  private readonly client: Rest | null;
  readonly enabled: boolean;

  constructor() {
    const key = process.env.ABLY_API_KEY;
    const driver = (process.env.REALTIME_DRIVER || (key ? 'ably' : 'socketio')).toLowerCase();
    let enabled = driver === 'ably' && !!key;
    let client: Rest | null = null;
    if (driver === 'ably' && !key) {
      this.logger.warn('REALTIME_DRIVER=ably but ABLY_API_KEY is unset — real-time disabled (Socket.IO fallback)');
    }
    if (enabled) {
      try {
        // Throws on a malformed key (not "appId.keyId:secret") — never let that
        // crash the whole app; degrade to the Socket.IO fallback instead.
        client = new Rest(key as string);
      } catch (e) {
        this.logger.error(`Invalid ABLY_API_KEY — real-time disabled (Socket.IO fallback): ${(e as Error).message}`);
        enabled = false;
      }
    }
    this.enabled = enabled;
    this.client = client;
    this.logger.log(`Real-time driver: ${this.enabled ? 'ably' : 'socketio'}`);
  }

  /**
   * Fire-and-forget publish. Best-effort by design (mirrors the old gateway
   * emits): a transient Ably hiccup must never fail the domain write that
   * triggered it, so failures are logged and swallowed.
   */
  publish(channel: string, event: string, data: any): void {
    if (!this.client) return;
    this.client.channels
      .get(channel)
      .publish(event, data)
      .catch((e) => this.logger.warn(`Ably publish to '${channel}' failed: ${(e as Error).message}`));
  }

  /**
   * Mint a short-lived Ably token whose capability is decided SERVER-SIDE from
   * the verified JWT. The client can only ever subscribe to its own tenant
   * (`org:<id>`), its personal channel (`user:<id>`) and the shared `system`
   * channel — it cannot widen this, so tenant isolation is enforced at Ably.
   * Used as the Ably SDK's authCallback / authUrl target.
   */
  async createTokenRequest(opts: { userId: string; organizationId: string | null }): Promise<unknown> {
    if (!this.client) throw new Error('Ably is not enabled on this server');
    const capability: Record<string, string[]> = { system: ['subscribe'] };
    if (opts.organizationId) capability[`org:${opts.organizationId}`] = ['subscribe'];
    capability[`user:${opts.userId}`] = ['subscribe'];
    return this.client.auth.createTokenRequest({
      clientId: opts.userId,
      capability: JSON.stringify(capability),
    });
  }
}
