import { Module, Global } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EventsGateway } from './events.gateway.js';
import { JWT_SECRET } from '../common/constants/jwt.constant.js';

@Global()
@Module({
  // The gateway verifies the socket handshake JWT (same secret as HTTP auth) so
  // it can scope sensitive rooms (support queues) to the authenticated tenant.
  imports: [JwtModule.register({ secret: JWT_SECRET })],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class WebsocketModule {}
