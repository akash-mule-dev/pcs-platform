import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Line } from './line.entity.js';
import { LinesService } from './lines.service.js';
import { LinesController } from './lines.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([Line])],
  controllers: [LinesController],
  providers: [LinesService],
  exports: [LinesService, TypeOrmModule],
})
export class LinesModule {}
