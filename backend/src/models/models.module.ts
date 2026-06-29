import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Model3D } from './model.entity.js';
import { ConversionJob } from '../conversion/conversion-job.entity.js';
import { ModelsService } from './models.service.js';
import { ModelsController } from './models.controller.js';

@Module({
  // ConversionJob is registered entity-only (not the conversion module) so the
  // service can DERIVE metres-per-unit from the source on read — see getWithScale.
  imports: [TypeOrmModule.forFeature([Model3D, ConversionJob])],
  controllers: [ModelsController],
  providers: [ModelsService],
  exports: [ModelsService, TypeOrmModule],
})
export class ModelsModule {}
