import { Module, Logger } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { DatabaseModule } from './database/database.module.js';
import { StorageModule } from './storage/storage.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { ProcessesModule } from './processes/processes.module.js';
import { StagesModule } from './stages/stages.module.js';
import { LinesModule } from './lines/lines.module.js';
import { ModelsModule } from './models/models.module.js';
import { QualityDataModule } from './quality-data/quality-data.module.js';
import { StationsModule } from './stations/stations.module.js';
import { WorkOrdersModule } from './work-orders/work-orders.module.js';
import { TimeTrackingModule } from './time-tracking/time-tracking.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { WebsocketModule } from './websocket/websocket.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { CadConversionModule } from './cad-conversion/cad-conversion.module.js';
import { ConversionModule } from './conversion/conversion.module.js';
import { CoordinationModule } from './coordination/coordination.module.js';
import { SeedModule } from './seed/seed.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { AlertsModule } from './alerts/alerts.module.js';
import { AuditModule } from './audit/audit.module.js';
import { SearchModule } from './search/search.module.js';
import { HealthModule } from './health/health.module.js';
import { OrganizationModule } from './organization/organization.module.js';
import { MaterialsModule } from './materials/materials.module.js';
import { EquipmentModule } from './equipment/equipment.module.js';
import { WorkforceModule } from './workforce/workforce.module.js';
import { CostingModule } from './costing/costing.module.js';
import { TraceabilityModule } from './traceability/traceability.module.js';
import { TemplatesModule } from './templates/templates.module.js';
import { SchedulingModule } from './scheduling/scheduling.module.js';
import { RbacModule } from './rbac/rbac.module.js';
import { SpcModule } from './spc/spc.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { ShippingModule } from './shipping/shipping.module.js';
import { ProductionOrdersModule } from './projects/production-orders.module.js';
import { MaterialPlanningModule } from './projects/material-planning.module.js';
import { QualityReportsModule } from './quality-reports/quality-reports.module.js';
import { LibraryModule } from './library/library.module.js';
import { SupportModule } from './support/support.module.js';
import { PlatformInsightsModule } from './platform-insights/platform-insights.module.js';
import { TenantInterceptor } from './common/tenant/tenant.interceptor.js';

// In-process @Cron timers (ScheduleModule) keep the Node event loop alive. On
// Vercel Fluid that pins the function instance "always-on" and bills Provisioned
// Memory 24/7 (the cause of the runaway GB-Hrs). So the in-process scheduler is
// disabled ONLY on the Vercel PRODUCTION deployment, where Vercel Cron drives the
// same jobs by hitting the secret-guarded `/api/internal/*` endpoints
// (alerts-cron.controller + project-cron.controller, scheduled in vercel.json).
// It stays ENABLED everywhere Vercel Cron does NOT run — local dev (`app.listen`
// in main.ts) AND non-production Vercel deployments (preview / dev-branch, which
// Vercel Cron never invokes) — so those keep firing jobs exactly as today.
// Override the auto-detection explicitly with IN_PROCESS_SCHEDULER=true|false.
const inProcessScheduler =
  process.env.IN_PROCESS_SCHEDULER !== undefined
    ? process.env.IN_PROCESS_SCHEDULER === 'true'
    : process.env.VERCEL_ENV !== 'production';

// Make a misconfiguration loud rather than silent: when the in-process scheduler
// is off, the alert sweeps + retention purge are driven SOLELY by Vercel Cron,
// which fails closed (503) unless CRON_SECRET is set on the Vercel project.
if (!inProcessScheduler && !process.env.CRON_SECRET) {
  new Logger('AppModule').warn(
    'In-process scheduler is OFF but CRON_SECRET is unset — Vercel Cron jobs ' +
      '(alerts + retention purge) will be rejected with 503 and will NOT run. Set CRON_SECRET.',
  );
}

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      serveRoot: '/ar',
    }),
    // Only ever loaded off-serverless — see `inProcessScheduler` above.
    ...(inProcessScheduler ? [ScheduleModule.forRoot()] : []),
    ThrottlerModule.forRoot([{
      ttl: parseInt(process.env.THROTTLE_TTL || '60000', 10),
      limit: parseInt(process.env.THROTTLE_LIMIT || '300', 10),
    }]),
    DatabaseModule,
    StorageModule,
    WebsocketModule,
    RealtimeModule,
    AuthModule,
    UsersModule,
    ProcessesModule,
    StagesModule,
    LinesModule,
    ModelsModule,
    QualityDataModule,
    StationsModule,
    WorkOrdersModule,
    TimeTrackingModule,
    DashboardModule,
    CadConversionModule,
    ConversionModule,
    CoordinationModule,
    SeedModule,
    NotificationsModule,
    AlertsModule,
    AuditModule,
    SearchModule,
    HealthModule,
    OrganizationModule,
    MaterialsModule,
    EquipmentModule,
    WorkforceModule,
    CostingModule,
    TraceabilityModule,
    TemplatesModule,
    SchedulingModule,
    RbacModule,
    LibraryModule,
    SupportModule,
    SpcModule,
    ProjectsModule,
    ShippingModule,
    ProductionOrdersModule,
    MaterialPlanningModule,
    QualityReportsModule,
    PlatformInsightsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantInterceptor,
    },
  ],
})
export class AppModule {}