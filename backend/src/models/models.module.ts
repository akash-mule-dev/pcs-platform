import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Model3D } from './model.entity.js';
import { ModelsService } from './models.service.js';
import { ModelsController } from './models.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([Model3D])],
  controllers: [ModelsController],
  providers: [ModelsService],
  exports: [ModelsService, TypeOrmModule],
})
export class ModelsModule {}
