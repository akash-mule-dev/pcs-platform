import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QualityData } from '../quality-data/quality-data.entity.js';
import { SpcService } from './spc.service.js';
import { SpcController } from './spc.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([QualityData])],
  controllers: [SpcController],
  providers: [SpcService],
  exports: [SpcService],
})
export class SpcModule {}
