# Database migrations & the `synchronize` cutover

## Why this matters

Today the backend runs with TypeORM **`synchronize: true` by default** (see
`src/database/database.module.ts`). On every boot TypeORM auto-mutates the live
schema to match the entities. That is convenient in early development but is
**dangerous in production**:

- It can silently **drop or rewrite columns** (data loss) when an entity changes.
- There is **no schema history** and no rollback.
- There is a **drift window**: if a deploy ships new entity fields and the boot
  sync fails or hasn't completed, queries that `SELECT` those columns throw 500s.
  (That is exactly what caused the earlier dashboard / time‑tracking 500s.)

The fix is to manage the schema with **committed migrations** and turn
`synchronize` off. This doc is the one‑time cutover procedure plus the ongoing
workflow.

> ⚠️ The schema apply steps touch the live (Neon) database. Take a backup / Neon
> branch first. These steps must be run by someone with DB access — they are not
> automated here.

---

## What was already fixed in code

- **`src/database/typeorm.config.ts`** — the CLI data source now points at the
  **compiled** entities/migrations (`dist/**`) and includes `ssl`, so the CLI no
  longer fails with *"TypeScript enum is not supported in strip-only mode"* and
  can reach Neon.
- **`package.json`** — `migration:generate` / `migration:run` / `migration:revert`
  now build first, then run the TypeORM CLI against `dist/database/typeorm.config.js`.
  Added `migration:create` for hand‑written migrations.
- **`src/database/database.module.ts`** — `migrationsRun` now triggers whenever
  `synchronize` is off (any environment), not only in production. So once you set
  `DB_SYNCHRONIZE=false`, committed migrations apply automatically on boot.

`synchronize` still **defaults ON** so nothing changes until you deliberately set
`DB_SYNCHRONIZE=false`.

---

## One‑time cutover

### 0. Back up
Snapshot the database (or create a Neon branch you can restore from).

### 1. Remove the legacy bootstrap migration
`src/database/migrations/1780800000000-TenantFoundation.ts` was never recorded as
run, and it `ALTER`s `users` — which would fail on a fresh DB because its
timestamp is older than the baseline (so it would run *before* the tables exist).
Its work (default org + `users.organization_id` backfill) is already done at boot
by `TenantBootstrapService`. **Delete that file** so the baseline is the single
source of truth.

### 2. Generate the baseline against an EMPTY database
Generating against your current Neon DB would produce an *empty* migration,
because the schema already matches the entities (synchronize put it there). To
capture the full `CREATE` schema you must diff the entities against an **empty**
Postgres:

```bash
# Easiest: a throwaway local Postgres
docker run --rm -d --name pcs-baseline -e POSTGRES_PASSWORD=pcs -p 5599:5432 postgres:16

# Point the CLI at it just for this command, then generate:
DATABASE_URL="postgresql://postgres:pcs@localhost:5599/postgres" DB_SSL=false \
  npm run migration:generate -- src/database/migrations/Baseline

docker rm -f pcs-baseline
```

This writes `src/database/migrations/<timestamp>-Baseline.ts` containing the full
schema. Open it and sanity‑check that it creates every table, enum and index.

### 3. Mark the baseline as already applied on the real DB
Your Neon DB already has this schema, so you must **not** run the baseline there
(it would try to re‑create existing tables). Instead record it as applied so
future `migration:run` skips it. Read the class name + timestamp from the file
header, e.g. `export class Baseline1781000000000` → name `Baseline1781000000000`,
timestamp `1781000000000`. Then, connected to the **production** DB:

```sql
CREATE TABLE IF NOT EXISTS migrations (
  id serial PRIMARY KEY,
  "timestamp" bigint NOT NULL,
  name varchar NOT NULL
);
INSERT INTO migrations ("timestamp", name)
VALUES (1781000000000, 'Baseline1781000000000');
```

(For a brand‑new/empty environment, skip this INSERT and just let
`migration:run` create everything.)

### 4. Flip synchronize off
Set in the backend environment (Neon/prod and local):

```
DB_SYNCHRONIZE=false
```

### 5. Verify
Restart the backend. On boot it now runs migrations instead of syncing; the
baseline is marked applied so it is a no‑op, and the schema is untouched. Confirm
the app boots and key screens load (dashboard, work orders, time tracking).

---

## Day‑to‑day workflow (after cutover)

1. Change an entity (add a column, table, index…).
2. Generate the diff migration:
   ```bash
   npm run migration:generate -- src/database/migrations/AddWidgetColumn
   ```
3. **Review** the generated SQL — never commit it unread. Watch for accidental
   `DROP`s; TypeORM will drop columns/tables you removed from entities.
4. Commit it. It applies automatically on the next deploy (boot), or manually:
   ```bash
   npm run migration:run
   ```
5. Roll back the last migration if needed:
   ```bash
   npm run migration:revert
   ```

## Notes

- The CLI scripts build first (`nest build`) so the compiled `dist/**` the data
  source globs match is always current.
- Keep `migrations` committed and in timestamp order; never edit one that has
  already run in any environment — add a new one instead.
- `TenantBootstrapService` still seeds the default org + backfills on boot; it is
  idempotent and independent of the migration system.
- Once migrations are the source of truth, you can delete the
  `synchronize`‑defaults‑ON comment/behaviour and make `false` the default in
  `database.module.ts`.
