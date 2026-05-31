import { Module, Logger } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

const logger = new Logger('DatabaseModule');
const databaseUrl = process.env.DATABASE_URL;
const isProduction = process.env.NODE_ENV === 'production';

const connectionConfig = databaseUrl
  ? {
      type: 'postgres' as const,
      url: databaseUrl,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    }
  : {
      type: 'postgres' as const,
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USER || 'pcs_user',
      password: process.env.DB_PASSWORD || 'pcs_password',
      database: process.env.DB_NAME || 'pcs_db',
    };

const connectTimeoutMs = parseInt(process.env.DB_CONNECT_TIMEOUT || '8000', 10);

// synchronize auto-mutates the DB schema to match the entities on boot.
// This app currently ships NO migrations, so synchronize is load-bearing: it
// is what keeps the deployed schema in step with the entities (e.g. the
// time_entries columns the eager relations select). It therefore defaults ON,
// including in production. Once real migrations exist, set DB_SYNCHRONIZE=false
// and rely on migrationsRun instead.
const synchronize =
  process.env.DB_SYNCHRONIZE !== undefined
    ? process.env.DB_SYNCHRONIZE === 'true'
    : true;

if (synchronize && isProduction) {
  logger.warn('TypeORM synchronize is ON in production — required until DB migrations exist. Set DB_SYNCHRONIZE=false after adding migrations.');
}

@Module({
  imports: [
    TypeOrmModule.forRoot({
      ...connectionConfig,
      autoLoadEntities: true,
      synchronize,
      // Run committed migrations on boot only when synchronize is disabled
      // (i.e. once migrations have been generated and DB_SYNCHRONIZE=false).
      migrationsRun: !synchronize && isProduction,
      migrations: ['dist/database/migrations/*.js'],
      extra: {
        connectionTimeoutMillis: connectTimeoutMs,
        query_timeout: 10000,
      },
      retryAttempts: 2,
      retryDelay: 1000,
    }),
  ],
})
export class DatabaseModule {}
