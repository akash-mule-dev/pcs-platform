import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MaterialLot } from './entities/material-lot.entity.js';
import { SerialUnit } from './entities/serial-unit.entity.js';
import { GenealogyLink } from './entities/genealogy-link.entity.js';
import { TraceabilityService } from './traceability.service.js';
import { TraceabilityController } from './traceability.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([MaterialLot, SerialUnit, GenealogyLink])],
  controllers: [TraceabilityController],
  providers: [TraceabilityService],
  exports: [TraceabilityService, TypeOrmModule],
})
export class TraceabilityModule {}
