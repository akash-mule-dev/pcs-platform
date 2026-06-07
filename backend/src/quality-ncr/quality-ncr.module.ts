import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ncr } from './entities/ncr.entity.js';
import { Capa } from './entities/capa.entity.js';
import { QualityNcrService } from './quality-ncr.service.js';
import { NcrController } from './ncr.controller.js';
import { CapaController } from './capa.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([Ncr, Capa])],
  controllers: [NcrController, CapaController],
  providers: [QualityNcrService],
  exports: [QualityNcrService, TypeOrmModule],
})
export class QualityNcrModule {}
