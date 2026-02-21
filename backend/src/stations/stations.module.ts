import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Station } from './station.entity.js';
import { StationsService } from './stations.service.js';
import { StationsController } from './stations.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([Station])],
  controllers: [StationsController],
  providers: [StationsService],
  exports: [StationsService, TypeOrmModule],
})
export class StationsModule {}
