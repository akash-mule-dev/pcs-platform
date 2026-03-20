import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoordinationPackage } from './coordination-package.entity.js';
import { Drawing } from './drawing.entity.js';
import { CoordinationService } from './coordination.service.js';
import { CoordinationController } from './coordination.controller.js';
import { ModelsModule } from '../models/models.module.js';
import { CadConversionModule } from '../cad-conversion/cad-conversion.module.js';
@Module({
  imports: [
    TypeOrmModule.forFeature([CoordinationPackage, Drawing]),
    ModelsModule,
    CadConversionModule,
  ],
  controllers: [CoordinationController],
  providers: [CoordinationService],
  exports: [CoordinationService],
})
export class CoordinationModule {}
