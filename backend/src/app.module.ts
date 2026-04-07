import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from './database/database.module.js';
import { StorageModule } from './storage/storage.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { ProductsModule } from './products/products.module.js';
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
import { CadConversionModule } from './cad-conversion/cad-conversion.module.js';
import { CoordinationModule } from './coordination/coordination.module.js';
import { SeedModule } from './seed/seed.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { AlertsModule } from './alerts/alerts.module.js';
import { AuditModule } from './audit/audit.module.js';
import { SearchModule } from './search/search.module.js';
import { HealthModule } from './health/health.module.js';
import { OrganizationModule } from './organization/organization.module.js';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      serveRoot: '/ar',
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{
      ttl: parseInt(process.env.THROTTLE_TTL || '60000', 10),
      limit: parseInt(process.env.THROTTLE_LIMIT || '300', 10),
    }]),
    DatabaseModule,
    StorageModule,
    WebsocketModule,
    AuthModule,
    UsersModule,
    ProductsModule,
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
    CoordinationModule,
    SeedModule,
    NotificationsModule,
    AlertsModule,
    AuditModule,
    SearchModule,
    HealthModule,
    OrganizationModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
