import 'dotenv/config';
import { DataSource } from 'typeorm';

/**
 * TypeORM CLI data source configuration for generating and running migrations.
 *
 * Usage:
 *   npx typeorm migration:generate -d src/database/typeorm.config.ts src/database/migrations/MigrationName
 *   npx typeorm migration:run -d src/database/typeorm.config.ts
 *   npx typeorm migration:revert -d src/database/typeorm.config.ts
 */
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5433', 10),
  username: process.env.DB_USER || 'pcs_user',
  password: process.env.DB_PASSWORD || 'pcs_password',
  database: process.env.DB_NAME || 'pcs_platform',
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
});
