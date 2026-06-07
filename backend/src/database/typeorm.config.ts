import 'dotenv/config';
import { DataSource } from 'typeorm';

/**
 * TypeORM CLI data source for generating and running migrations.
 *
 * IMPORTANT: this file is consumed *compiled* as dist/database/typeorm.config.js
 * so the CLI never loads .ts under Node's strip-only mode (which rejects the
 * `enum` declarations in the entities). The npm scripts build first, then point
 * the CLI at the dist copy:
 *
 *   npm run migration:generate -- src/database/migrations/MyChange
 *   npm run migration:run
 *   npm run migration:revert
 *
 * Globs resolve relative to this file (when compiled, __dirname = dist/database)
 * so they match the emitted JS entities and migrations. `ssl` mirrors the
 * runtime config so the CLI can connect to a managed Postgres such as Neon.
 */
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5433', 10),
  username: process.env.DB_USER || 'pcs_user',
  password: process.env.DB_PASSWORD || 'pcs_password',
  database: process.env.DB_NAME || 'pcs_platform',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  entities: [__dirname + '/../**/*.entity.js'],
  migrations: [__dirname + '/migrations/*.js'],
  synchronize: false,
});
