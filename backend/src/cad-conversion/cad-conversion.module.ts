import { Module } from '@nestjs/common';
import { CadConversionService } from './cad-conversion.service.js';
import { CadConversionController } from './cad-conversion.controller.js';
import { ModelsModule } from '../models/models.module.js';

@Module({
  imports: [ModelsModule],
  controllers: [CadConversionController],
  providers: [CadConversionService],
  exports: [CadConversionService],
})
export class CadConversionModule {}
