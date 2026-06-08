# Multi-tenancy & data isolation

Shared-database, row-level multi-tenancy: one deployment serves many customers
(organizations); every customer-owned row carries an `organization_id` and is
isolated by it. Isolation is **defense-in-depth** — an application layer for
ergonomics/performance and a database layer (RLS) as the hard guarantee.

## The four layers

1. **Request context** — `TenantContext` (AsyncLocalStorage) holds the caller's
   `organizationId`; `TenantInterceptor` populates it from the JWT on every
   request. (`common/tenant/`.)
2. **Write-stamp** — `TenantSubscriber` (`beforeInsert`) stamps `organization_id`
   from the context onto any entity that has the column. New rows are always
   tagged without each `create()` remembering to.
3. **App-level read scoping** — core services filter reads by
   `TenantContext.getOrganizationId()` (no-op for system/background contexts).
4. **RLS backstop** — Postgres policies restrict every read/write to the org in
   the `app.current_org` GUC. This is the layer that makes a forgotten `WHERE`
   harmless. Applied by `migrations/1781300000000-TenantRls.ts`.

Pre-existing rows are assigned to a default org on boot by `TenantBootstrapService`.

## Enabling RLS (one-time, after the migration cutover)

RLS only enforces once (a) the policies exist and (b) the app sets the GUC per
request. Order:

1. Complete the migration cutover in `MIGRATIONS.md` (baseline + `DB_SYNCHRONIZE=false`).
2. `npm run migration:run` — applies `TenantRls` after the baseline. Because the
   policy allows-all when the GUC is unset, the app keeps working immediately even
   before the GUC is wired.
3. Wire the per-request GUC (below) and set `DB_RLS=true`.
4. Verify isolation with a second org (below).

> Take a DB snapshot / Neon branch first. `FORCE ROW LEVEL SECURITY` constrains
> the app's own role, so a misconfigured GUC will make authed requests see
> nothing — fail safe, but verify in staging.

## Wiring the per-request GUC — pick one (Open Decision #1)

The GUC must be set on the **same connection** that runs the request's queries.
With Neon's **transaction pooler**, a plain `SET` won't persist, so:

### Option A — request-scoped transaction (recommended for the pooler)
Run each request inside one transaction and `SET LOCAL app.current_org`. Use
`nestjs-cls` + `@nestjs-cls/transactional` (TypeORM adapter) so all repositories
share the request's transactional `EntityManager`, then in a middleware:

```ts
// pseudocode — runs inside the CLS transaction for the request
await txEntityManager.query(
  `SELECT set_config('app.current_org', $1, true)`, // true = LOCAL (this tx only)
  [TenantContext.getOrganizationId() ?? ''],
);
```

### Option B — session/direct endpoint
Point the app at Neon's **direct** (non-pooled) connection and set the GUC per
request on the checked-out connection:

```ts
await dataSource.query(
  `SELECT set_config('app.current_org', $1, false)`,
  [TenantContext.getOrganizationId() ?? ''],
);
```

Gate either behind `DB_RLS==='true'` so it's inert until you enable it:

```ts
@Injectable()
export class TenantGucMiddleware implements NestMiddleware {
  use(req: any, _res: any, next: () => void) {
    if (process.env.DB_RLS !== 'true') return next();
    // set_config as above for the request's org, then next()
  }
}
```

## Verifying isolation (do this in staging)

1. Create **Org B** and a user in it (see Phase E / tenant admin).
2. Log in as the Org B user → `GET /api/work-orders` returns **0** rows.
3. Create a work order as Org B → it is stamped Org B; Org A still sees only its own.
4. Attempt to read an Org A record by id as Org B → 404/empty.
5. Confirm the original Org A (admin) user still sees all of its data unchanged.

## Notes & tradeoffs

- **Allow-all when GUC unset** keeps migrations, the boot backfill, and
  background jobs working. The cost: any authed request that fails to set the GUC
  would see all tenants — so the GUC middleware must run for every authed route.
  The stricter alternative is deny-all + a dedicated `BYPASSRLS` role for system
  tasks (Open Decision #3).
- App-level scoping (layer 3) and RLS (layer 4) are intentionally redundant; RLS
  is the guarantee, app-level keeps queries lean and fails closed if RLS is off.
- The RLS migration is information_schema-driven, so adding a new
  `TenantOwnedEntity` table is automatically covered on the next `migration:run`.
