# Database Migrations

In production the app runs with `synchronize` **off** and applies the committed
migrations in this folder on boot (`migrationsRun` is enabled in production).
In development/demo, `synchronize` stays on by default for convenience.

## Generate the initial baseline migration

You need a Postgres instance that matches the target schema's starting point
(an empty DB is fine for the first/baseline migration). The repo ships a
`docker-compose.yml` with Postgres:

```bash
# 1. Start a local Postgres
docker compose up -d postgres

# 2. Point the CLI data source at it (env or src/database/typeorm.config.ts defaults)
export DATABASE_URL=postgresql://pcs_user:pcs_password@localhost:5433/pcs_platform

# 3. Generate the baseline from the entities
npm run migration:generate -- src/database/migrations/InitialSchema

# 4. Review the generated file, then apply it
npm run migration:run
```

## Day-to-day workflow

```bash
# After changing an entity:
npm run migration:generate -- src/database/migrations/DescribeYourChange
npm run migration:run      # apply locally
npm run migration:revert   # roll back the last migration
```

## Production

- Keep `synchronize` off (default in production; never override `DB_SYNCHRONIZE=true` there).
- Commit generated migrations; the app applies them automatically on deploy
  (`migrationsRun: true` in production). The compiled files are loaded from
  `dist/database/migrations/*.js`.
