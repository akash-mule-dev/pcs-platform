import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QualityData } from './quality-data.entity.js';
import { QualityDataService } from './quality-data.service.js';
import { QualityDataController } from './quality-data.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([QualityData])],
  controllers: [QualityDataController],
  providers: [QualityDataService],
  exports: [QualityDataService, TypeOrmModule],
})
export class QualityDataModule {}
