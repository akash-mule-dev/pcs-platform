import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FormTemplate } from './entities/form-template.entity.js';
import { TemplatesService } from './templates.service.js';
import { TemplatesController } from './templates.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([FormTemplate])],
  controllers: [TemplatesController],
  providers: [TemplatesService],
  exports: [TemplatesService, TypeOrmModule],
})
export class TemplatesModule {}
