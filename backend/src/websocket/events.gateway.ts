import { WebSocketGateway, WebSocketServer, OnGatewayInit } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { Injectable } from '@nestjs/common';

@Injectable()
@WebSocketGateway({ cors: { origin: ['http://localhost:4200', 'http://localhost:8100'] } })
export class EventsGateway implements OnGatewayInit {
  @WebSocketServer()
  server: Server;

  afterInit(_server: Server) {
    // Gateway initialized
  }

  emitTimeEntryUpdate(data: any) {
    if (this.server) {
      this.server.emit('time-entry-update', data);
    }
  }

  emitStageUpdate(data: any) {
    if (this.server) {
      this.server.emit('stage-update', data);
    }
  }

  emitDashboardRefresh(data?: any) {
    if (this.server) {
      this.server.emit('dashboard-refresh', data || { timestamp: new Date().toISOString() });
    }
  }
}
