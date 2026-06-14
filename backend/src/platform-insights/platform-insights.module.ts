import { Module } from '@nestjs/common';
import { PlatformInsightsService } from './platform-insights.service.js';
import { PlatformInsightsController } from './platform-insights.controller.js';

/**
 * Platform "Company Insights" — cross-tenant usage analytics. Reads ACROSS
 * organizations via the shared DataSource (no per-feature repositories), so it
 * needs no TypeOrmModule.forFeature; the PermissionsGuard/JwtAuthGuard resolve
 * from the @Global RbacModule/AuthModule.
 */
@Module({
  controllers: [PlatformInsightsController],
  providers: [PlatformInsightsService],
})
export class PlatformInsightsModule {}
