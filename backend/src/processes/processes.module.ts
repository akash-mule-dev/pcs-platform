import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Process } from './process.entity.js';
import { ProcessesService } from './processes.service.js';
import { ProcessesController } from './processes.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([Process])],
  controllers: [ProcessesController],
  providers: [ProcessesService],
  exports: [ProcessesService, TypeOrmModule],
})
export class ProcessesModule {}
