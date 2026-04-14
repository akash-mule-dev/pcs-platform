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

if (!isProduction) {
  logger.warn('TypeORM synchronize is ON — never use this in production. Use migrations instead.');
}

@Module({
  imports: [
    TypeOrmModule.forRoot({
      ...connectionConfig,
      autoLoadEntities: true,
      synchronize: true,
      migrationsRun: false,
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
