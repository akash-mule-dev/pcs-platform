# PCS MES — Hardening & Remaining Activation Steps

**Date:** 2026-06-07. The 10-phase MES is built, running, and verified live. This is the
deliberate-apply package for the last items that shouldn't be done blind on a running system.

---

## 1. Form.io visual drag-n-drop builder (finish Phase 0c UI)

The Templates admin (`/templates`) already works with a JSON-schema editor. To get the
visual builder:

```bash
cd frontend && npm install @formio/angular   # already added to package.json
```

Then swap the JSON `<textarea>` in `templates.component.ts` for the builder:

```ts
// imports: add FormioModule
import { FormioModule } from '@formio/angular';
// component imports: [ ... , FormioModule ]
```
```html
<!-- replace the schema textarea with: -->
<formio-builder [form]="builderForm" (change)="onBuilderChange($event)"></formio-builder>
```
```ts
builderForm: any = { display: 'form', components: [] };
onBuilderChange(e: any) { if (e?.form) this.builderForm = e.form; }
// on save: body.schema = this.builderForm;
```
Render a filled form elsewhere with `<formio [form]="template.schema" [submission]="{data}">`.
I'll wire + verify this live once the package is installed (the exact selector/version I want to confirm running, not blind).

**PDF:** generate the NCR/report PDF server-side from the template + data. Add `pdfmake`
or render the filled `<formio>` to HTML and use Puppeteer; expose `GET /api/ncr/:id/pdf`.

---

## 2. Multi-tenancy hardening — org_id on existing tables + Postgres RLS

New modules are already tenant-scoped. The **existing** tables (products, processes, stages,
lines, stations, work_orders, work_order_stages, time_entries, models, quality_data) are not
yet. Two steps, applied deliberately:

### 2a. Add `organization_id` to existing entities (so `synchronize` keeps the column)
For each existing entity, extend the tenant base (additive, nullable — safe, no behavior change):
```ts
import { TenantOwnedEntity } from '../common/tenant/tenant-owned.entity.js';
// e.g. work-order.entity.ts
export class WorkOrder extends TenantOwnedEntity { /* …existing columns… */ }
```
Then extend `tenant-bootstrap.service.ts` to backfill them on boot (it already does `users`):
```ts
for (const table of ['products','processes','stages','lines','stations',
  'work_orders','work_order_stages','time_entries','models','quality_data']) {
  await this.dataSource.query(
    `UPDATE ${table} SET organization_id = $1 WHERE organization_id IS NULL`, [org.id]);
}
```
After this, scoping is automatic for any service that extends `TenantScopedService`; migrate the
existing services onto it (or rely on RLS below).

### 2b. Postgres Row-Level Security (the DB-enforced guarantee)
Apply this **once, deliberately** (it's lockout-risky if the request GUC isn't set):
```sql
-- for each tenant table:
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON work_orders USING
  (organization_id = current_setting('app.current_org', true)::uuid);
-- repeat per table; grant BYPASSRLS to a migration/admin role for maintenance.
```
And set the GUC per request — extend `TenantInterceptor` to run inside a transaction that does
`SET LOCAL app.current_org = '<org>'` before the handler (transaction-scoped so it's safe with
the connection pool). Keep RLS **off** until this interceptor change is in and tested, or every
query returns empty.

> Order: 2a (columns + backfill) → verify app still works → add the GUC interceptor → enable RLS table-by-table, testing each.

---

## 3. Mobile (operator app) — surface the new features

Needs `cd mobile && npm install` (for `socket.io-client`, already in package.json). Highest-value
operator screens to add (React Native, mirroring the existing screen pattern + the `api`/`socketService` already there):
- **Raise NCR** from a work order (POST /ncr with templateId + dataJson)
- **Report machine downtime** (POST /equipment/:id/downtime) + end it
- **My skills/certs** (GET /skills/user/:id) on the profile screen
- **Materials lookup** (GET /materials, /inventory/stock)

These need the Expo dev build + a device/emulator to verify, so they're best done with that loop running.

---

## 4. Cleanup
Smoke-test demo rows remain (harmless): material `SMOKE-SS304`, equipment `SMOKE-LASER`,
skill `SMOKE-WELD`, lot `HEAT-001`, serial `SN-0001`, "Smoke test NCR", and two RBAC overrides
(supervisor→materials, operator→reports). Delete via the UI or DELETE endpoints when ready.

Also still open from the original `PRE-DELIVERY-CHECKLIST`: rotate live credentials, and generate
real DB migrations (the typeorm CLI needs `ts-node` or compiled JS — see the bootstrap note).
