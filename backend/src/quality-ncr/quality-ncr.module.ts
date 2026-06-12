import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ncr } from './entities/ncr.entity.js';
import { Capa } from './entities/capa.entity.js';
import { NcrEvent } from './entities/ncr-event.entity.js';
import { User } from '../auth/entities/user.entity.js';
import { QualityNcrService } from './quality-ncr.service.js';
import { NcrController } from './ncr.controller.js';
import { CapaController } from './capa.controller.js';
import { QualityNotifyModule } from '../quality-notify/quality-notify.module.js';

@Module({
  // User is referenced as an ENTITY only (actor names) — no auth-module dep.
  imports: [TypeOrmModule.forFeature([Ncr, Capa, NcrEvent, User]), QualityNotifyModule],
  controllers: [NcrController, CapaController],
  providers: [QualityNcrService],
  exports: [QualityNcrService, TypeOrmModule],
})
export class QualityNcrModule {}
