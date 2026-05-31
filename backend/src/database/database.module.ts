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

// synchronize auto-mutates the DB schema to match entities. Convenient for
// dev/demo but dangerous in production (silent data loss on entity changes).
// Default: ON for non-production, OFF for production. Override with
// DB_SYNCHRONIZE=true|false. Production can never enable it implicitly.
const synchronize =
  process.env.DB_SYNCHRONIZE !== undefined
    ? process.env.DB_SYNCHRONIZE === 'true' && !isProduction
    : !isProduction;

if (synchronize) {
  logger.warn('TypeORM synchronize is ON — never use this in production. Use migrations instead.');
}

@Module({
  imports: [
    TypeOrmModule.forRoot({
      ...connectionConfig,
      autoLoadEntities: true,
      synchronize,
      // In production, apply committed migrations on boot (synchronize is off there).
      migrationsRun: isProduction,
      migrations: isProduction ? ['dist/database/migrations/*.js'] : [],
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
