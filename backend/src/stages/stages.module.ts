import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Stage } from './stage.entity.js';
import { StagesService } from './stages.service.js';
import { StagesController } from './stages.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([Stage])],
  controllers: [StagesController],
  providers: [StagesService],
  exports: [StagesService, TypeOrmModule],
})
export class StagesModule {}
