import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { SeedModule } from '../seed/seed.module.js';

@Module({
  imports: [SeedModule],
  controllers: [HealthController],
})
export class HealthModule {}
