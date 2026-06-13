import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Organization } from '../organization/organization.entity.js';
import { Process } from '../processes/process.entity.js';
import { Stage } from '../stages/stage.entity.js';
import { FormTemplate } from '../templates/entities/form-template.entity.js';
import { LibraryService } from './library.service.js';
import { LibraryController } from './library.controller.js';
import { LibraryBootstrapService } from './library-bootstrap.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Organization, Process, Stage, FormTemplate])],
  controllers: [LibraryController],
  providers: [LibraryService, LibraryBootstrapService],
  exports: [LibraryService],
})
export class LibraryModule {}
