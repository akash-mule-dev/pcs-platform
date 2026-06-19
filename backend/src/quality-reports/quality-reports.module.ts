import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QualityReport } from './quality-report.entity.js';
import { QualityReportEvent } from './quality-report-event.entity.js';
import { FormTemplate } from '../templates/entities/form-template.entity.js';
import { ProductionOrder } from '../projects/production-order.entity.js';
import { AssemblyNode } from '../projects/assembly-node.entity.js';
import { QualityReportsService } from './quality-reports.service.js';
import { QualityReportsController } from './quality-reports.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([QualityReport, QualityReportEvent, FormTemplate, ProductionOrder, AssemblyNode])],
  controllers: [QualityReportsController],
  providers: [QualityReportsService],
  exports: [QualityReportsService],
})
export class QualityReportsModule {}
