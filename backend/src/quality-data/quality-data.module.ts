import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QualityData } from './quality-data.entity.js';
import { User } from '../auth/entities/user.entity.js';
import { QualityDataService } from './quality-data.service.js';
import { QualityDataController } from './quality-data.controller.js';
import { QualityNotifyModule } from '../quality-notify/quality-notify.module.js';

@Module({
  // User is referenced as an ENTITY only (identity stamping) — no auth-module dep.
  imports: [TypeOrmModule.forFeature([QualityData, User]), QualityNotifyModule],
  controllers: [QualityDataController],
  providers: [QualityDataService],
  exports: [QualityDataService, TypeOrmModule],
})
export class QualityDataModule {}
