import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { ProductsModule } from './products/products.module.js';
import { ProcessesModule } from './processes/processes.module.js';
import { StagesModule } from './stages/stages.module.js';
import { LinesModule } from './lines/lines.module.js';
import { StationsModule } from './stations/stations.module.js';
import { WorkOrdersModule } from './work-orders/work-orders.module.js';
import { TimeTrackingModule } from './time-tracking/time-tracking.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { WebsocketModule } from './websocket/websocket.module.js';
import { SeedModule } from './seed/seed.module.js';

@Module({
  imports: [
    DatabaseModule,
    WebsocketModule,
    AuthModule,
    UsersModule,
    ProductsModule,
    ProcessesModule,
    StagesModule,
    LinesModule,
    StationsModule,
    WorkOrdersModule,
    TimeTrackingModule,
    DashboardModule,
    SeedModule,
  ],
})
export class AppModule {}
