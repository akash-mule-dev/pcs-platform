import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

const databaseUrl = process.env.DATABASE_URL;

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

@Module({
  imports: [
    TypeOrmModule.forRoot({
      ...connectionConfig,
      autoLoadEntities: true,
      synchronize: process.env.NODE_ENV !== 'production',
    }),
  ],
})
export class DatabaseModule {}
