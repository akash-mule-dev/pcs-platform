import { Module, Global } from '@nestjs/common';
import { AblyService } from './ably.service.js';
import { RealtimeController } from './realtime.controller.js';

/**
 * Real-time transport. Provides the AblyService (publish + token minting) used
 * by the EventsGateway to push events. @Global so the gateway can inject it
 * without WebsocketModule taking a direct dependency.
 */
@Global()
@Module({
  providers: [AblyService],
  controllers: [RealtimeController],
  exports: [AblyService],
})
export class RealtimeModule {}
