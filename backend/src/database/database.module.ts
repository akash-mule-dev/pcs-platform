import { Module, Logger } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantSubscriber } from '../common/tenant/tenant.subscriber.js';

const logger = new Logger('DatabaseModule');
const isProduction = process.env.NODE_ENV === 'production';

// DB selection by environment. Production (VERCEL_ENV=production) and local both
// use DATABASE_URL (locally that's backend/.env). In any NON-production Vercel
// environment (preview / the dev branch) we deliberately pin the dev DB to the
// SAME branch the local backend uses, via the custom `PCS_DEV_DATABASE_URL`:
// because it is NOT managed by the Neon/Vercel integration, its value can't be
// clobbered by the integration's auto-created per-preview branch URL (the
// `dev_DATABASE_URL` / branch-scoped `DATABASE_URL` overrides proved unreliable —
// that's why deployed dev used to land on a separate `preview/dev` branch).
// Fallbacks (`dev_DATABASE_URL` → `DATABASE_URL`) preserve the prior behaviour
// when the pin isn't set, and still guarantee a preview never hits production.
const isVercelProd = process.env.VERCEL_ENV === 'production';
const databaseUrl = isVercelProd
  ? process.env.DATABASE_URL
  : process.env.PCS_DEV_DATABASE_URL ||
    process.env['dev_DATABASE_URL'] ||
    process.env.DATABASE_URL;

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

// Log the target DB host (no credentials) so each environment's wiring is
// verifiable from the boot logs — e.g. confirming previews hit the dev branch,
// not production.
const dbTargetHost = (() => {
  try {
    return databaseUrl ? new URL(databaseUrl).host : `${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}`;
  } catch {
    return 'unparseable-DATABASE_URL';
  }
})();
logger.log(`Database target: ${dbTargetHost} (env=${process.env.VERCEL_ENV || process.env.NODE_ENV || 'local'}, synchronize=${synchronize})`);

@Module({
  imports: [
    TypeOrmModule.forRoot({
      ...connectionConfig,
      autoLoadEntities: true,
      synchronize,
      // Run committed migrations on boot whenever synchronize is disabled
      // (any environment) — i.e. once migrations exist and DB_SYNCHRONIZE=false.
      // Previously gated on isProduction too, which silently skipped migrations
      // in the dev/Neon setup and made the cutover impossible to test.
      migrationsRun: !synchronize,
      migrations: ['dist/database/migrations/*.js'],
      // Global tenant write-stamp (sets organization_id on insert from context).
      subscribers: [TenantSubscriber],
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
