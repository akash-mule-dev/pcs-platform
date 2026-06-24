import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Station } from './station.entity.js';
import { Line } from '../lines/line.entity.js';
import { StationsService } from './stations.service.js';
import { StationsController } from './stations.controller.js';
import { WebsocketModule } from '../websocket/websocket.module.js';

@Module({
  // Line is registered here too (for re-parent validation) — TypeORM dedupes the
  // entity at the DataSource level, so co-registering with LinesModule is safe.
  imports: [TypeOrmModule.forFeature([Station, Line]), WebsocketModule],
  controllers: [StationsController],
  providers: [StationsService],
  exports: [StationsService, TypeOrmModule],
})
export class StationsModule {}
