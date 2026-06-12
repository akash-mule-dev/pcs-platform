# PCS Platform — Claude Code Instructions

Full-stack production-coordination / MES for steel & structural **fabrication**.

- **Frontend:** Angular 17 (standalone components) — `frontend/`, dev server on port 4200
- **Backend:** NestJS 11 (REST + Socket.io) + TypeORM — `backend/`, port 3000
- **Mobile:** React Native + Expo — `mobile/`
- **Database:** PostgreSQL on **Neon**. `backend/.env` `DATABASE_URL` points at the **dev** branch (`pcs-dev-db`, isolated from prod). The production URL is backed up in `.vercel/.env.prod.bak`; prod is selected only when `VERCEL_ENV=production`.

## Execution style — work autonomously, end-to-end

- Complete tasks **fully** without stopping to ask "should I continue?" between steps.
  Decide on the best approach, then implement **all** of it.
- For a large task, do the thinking up front (optionally propose a short plan), then
  execute every step in one pass — don't pause to check in after each chunk.
- Break complex work into substeps internally, but carry them all out before handing back.
- **Always verify before declaring done:** build it, run the relevant tests, and/or start
  the app and exercise the change. Report results honestly (if tests fail, say so).
- Only stop early for a genuine blocker you cannot resolve yourself: an ambiguous
  requirement, a missing secret/credential, or a destructive/irreversible action that
  needs sign-off. Otherwise, keep going to completion.

## Running the app (verified)

The `nest` and `ng` CLI bin shims are missing from `node_modules/.bin`, so the documented
`npm start` / `npm run start:dev` commands fail with "not recognized". Invoke the CLIs
directly with `node` instead:

- **Backend (dev):** `cd backend && node node_modules/@nestjs/cli/bin/nest.js start --watch`
  → http://localhost:3000 (connects to the Neon **dev** DB — no local Postgres/Docker needed)
- **Frontend (dev):** `cd frontend && node node_modules/@angular/cli/bin/ng.js serve --port 4200`
  → http://localhost:4200 (calls the backend via `environment.ts` → `http://localhost:3000/api`)
- **Conversion worker (only if `REDIS_URL` is set):** `cd backend && npm run worker` — drains the
  BullMQ conversion queue. With no `REDIS_URL` the queue runs **inline** in the API process, so
  the worker isn't needed in plain dev.

The default web login is prefilled on the login screen (Neon dataset, admin role).

## Verifying changes (do this before claiming done)

- **Backend type-check:** `cd backend && node node_modules/@nestjs/cli/bin/nest.js build`
  — runs full `tsc` and catches type errors that `start --watch` (transpile-only) silently skips.
- **Frontend build/type-check:** `cd frontend && node node_modules/@angular/cli/bin/ng.js build`
  — includes Angular template type-checking.
- **Pure domain logic is unit-testable in isolation** — see `backend/src/projects/rollup-math.ts`
  and `progress-math.ts` (no Nest/TypeORM imports). Prefer extracting tricky calculations into
  such pure modules and testing them directly (`node --experimental-strip-types <file>`).

## Repository layout

```
backend/src/
  app.module.ts            # root module — every feature module is imported here
  database/                # TypeORM datasource, DatabaseModule, migrations/
  common/tenant/           # multi-tenancy: TenantOwnedEntity, TenantContext, TenantScopedService, interceptor, subscriber
  auth/  rbac/             # JWT auth + fine-grained RBAC: permission-catalog.ts, PermissionsGuard, roles API (system + custom roles)
  products/ materials/     # catalog products + BOM / materials / stock
  processes/ stages/       # a Process is an ordered list of Stages (the routing)
  work-orders/             # WorkOrder + WorkOrderStage — the stage-execution engine
  lines/ stations/ workforce/ equipment/ scheduling/ time-tracking/ traceability/ quality-* /
  storage/                 # pluggable StorageProvider (local | s3 | azure), STORAGE_TYPE env
  cad-conversion/          # spawns convert-*.mjs + extract-ifc-structure.mjs (web-ifc / assimp)
  conversion/              # async 3D→GLB pipeline: ConversionJob + queue (inline|BullMQ) + processor
  models/                  # Model3D (GLB) records + file streaming endpoints
  coordination/            # BIM coordination packages + drawings
  projects/                # ★ fabrication: Project, AssemblyNode tree, ImportFile, IFC import, production orders
  shipping/                # ★ fabrication: Shipment + ShipmentItem (the shipping list)
frontend/src/app/
  core/services/           # HTTP services (projects.service.ts, shipping.service.ts, conversion.service.ts, …)
  layout/                  # shell + side-nav (navGroups define the menu)
  projects/                # ★ project list, creation wizard, workspace (tree + 3D), per-order board/progress/quality/shipping
  shared/components/three-viewer/  # reusable three.js GLB viewer (modelUrl, highlightNames, meshClicked)
```

## The fabrication module (`backend/src/projects`, `backend/src/shipping`, `frontend/src/app/projects`)

End-to-end flow: **create project → import IFC → assembly tree + 3D → create production orders
(per customer/run) → step stage counts on the order board → ship → per-order progress.**

The **project is a pure design container** — it carries NO production status. One design can back
many production orders, so a single per-node status would be meaningless; all tracking is
per-order (count-based, on the order's work-order stages).

Core data model (one self-referencing tree absorbs every source format):

- `Project` — the job/contract container (org-scoped).
- `AssemblyNode` — **one self-referencing table** (`parent_id`) for the whole structure.
  `node_type` ∈ `group | assembly | subassembly | part`; carries `ifc_guid` (stable key + GLB
  mesh-node name for 3D highlight), promoted fab columns (`mark`, `profile`, `material_grade`,
  `length_mm`, `weight_kg`), a `properties` jsonb bag, and a `model_id` link. Design facts only —
  no status/percent columns.
- `ImportFile` — an uploaded source file (`conversion_job_id`, `model_id`, status, node_count).
- `ProductionOrder` — a per-customer/per-run instance of the project: its own process, quantity
  and status; releasing it creates one WorkOrder per assembly (`WorkOrder.production_order_id`).
- `Shipment` / `ShipmentItem` — shipping loads and the assemblies on them; what's shipped is
  derived from items on shipped/delivered loads (nothing written back onto the tree).
- `WorkOrder.assembly_node_id` — the **existing** WorkOrder/WorkOrderStage engine drives each
  fabricated node through a Process's stages (no parallel engine).

Key services & flows:

- **IFC import** (`ifc-import.service.ts`, `POST /api/projects/:id/import-ifc`): spawns
  `cad-conversion/scripts/extract-ifc-structure.mjs` (web-ifc) → a normalized JSON node tree →
  persisted into `assembly_nodes` **idempotently by `ifc_guid`**. The GLB is **always** built
  asynchronously via the conversion queue (`ConversionService.createJob`); `linkPendingModels` /
  `POST /api/projects/:id/resolve-models` link the finished GLB back to the nodes.
- **Production orders** (`production-order.service.ts`, `POST /api/projects/:id/orders`,
  `/api/orders/:id/*`): create-and-release transactionally generates per-assembly WorkOrders +
  stages with count totals (`quantity-math.ts`: `qtyDone`/`qtyTotal` per stage). The board
  (`GET /api/orders/:id/stage-board`) and progress (`GET /api/orders/:id/progress`) are
  count-based roll-ups scoped to that order.
- **Design summary** (`project-progress.service.ts` + pure `progress-math.ts`,
  `GET /api/projects/:id/progress`): node composition + total tonnage + work-order item count —
  feeds the workspace header and the portfolio list (`GET /api/projects/summary`).
- **Shipping gate** (`shipping.service.ts`): an assembly can be loaded once it has
  production-complete units (every non-skipped stage done across its work orders), no open NCRs,
  and unallocated quantity left; shipped totals come from shipment items.

## The quality module (`quality-data`, `quality-ncr`, `quality-reports`, `spc`, `quality-notify`)

End-to-end QA flow: **record inspection (web 3D / mobile AR / per-node) → auto-fail on
out-of-tolerance → failed entries queue for sign-off → raise NCR → investigate → disposition →
close (or CAPA) → gates lift** (work-order quality stages + shipping both block on open NCRs).

- **Pure rule modules** (unit-tested, no Nest/TypeORM): `quality-data/quality-math.ts`
  (tolerance evaluation + auto-fail + sign-off rules) and `quality-ncr/ncr-workflow.ts`
  (NCR/CAPA state machines). `npm run test:quality` runs both.
- **Identity is server-stamped, never client-supplied:** `inspector`/`inspectorUserId` default
  from the JWT on create; `PATCH /quality-data/:id/signoff` ignores any client `signoffBy` and
  stamps `signoffBy`/`signoffByUserId` from the authenticated user. Sign-off needs the dedicated
  `quality-analysis.signoff` permission (inspect ≠ approve).
- **NCR lifecycle is a state machine:** open → investigation → disposition → closed, cancel from
  open/investigation, reopen closed → investigation (clears `closed_at`/`closed_by`). Closing
  REQUIRES a disposition. Every action (create/transition/disposition/assignment/comment) appends
  an `ncr_events` row — `GET /api/ncr/:id/events` is the timeline; `GET /api/ncr/:id` returns
  `allowedTransitions` which the web + mobile detail UIs render as guided action buttons.
  CAPAs must be `verified` (stamps verifier) before they can close.
- **Numbering is per-organization** (`NCR-YYYY-NNNN`, `QR-YYYY-NNNN`) with unique
  `(organization_id, number)` indexes; allocation races retry on 23505.
- **Tenancy:** every quality read/write is org-scoped (incl. summaries/trends/SPC/by-model
  deletes); linked records (model/node/project/WO/quality entry/assignee) are validated to belong
  to the caller's org on create. `ncr_events` is RLS-enrolled by the `QualityGovernance` migration.
- **Eventing** (`quality-notify/`): failed inspections and NCR lifecycle changes emit the
  `quality-alert` websocket event; high/critical failures + raised NCRs notify the org's
  admin/manager/supervisors, assignments notify the assignee, sign-off decisions notify the
  inspector. All best-effort (never fails the write). Sign-off/NCR/CAPA mutations are audit-logged.
- **Evidence uploads** (`POST /quality-data/:id/evidence`) accept JPEG/PNG/WebP only (≤10 MB);
  the web inspection detail fetches them as authed blobs.
- **Regression suites:** `npm run test:quality` (pure rules), `npm run test:e2e:quality`
  (51-assertion live suite incl. tenant isolation — scratch DB, mirrors `test:e2e:orders`),
  plus `tests/suite/11-quality-data.api.spec.ts` and `tests/phase6-quality-enhancements.api.spec.ts`.

Front end: `/projects`, `/projects/:id` workspace tabs (Overview / Assemblies & 3D / Work Orders);
production tracking lives inside each order at `/projects/:id/orders/:orderId/(board|progress|quality|shipping)`.
The workspace auto-polls `resolve-models` while a GLB converts so the viewer appears on its own.

## Conventions (follow these)

- **ESM / NodeNext:** the backend uses ESM (NodeNext) module resolution — **relative imports must end
  in `.js`** (e.g. `import { Project } from './project.entity.js'`), even though the source is `.ts`.
- **Multi-tenancy:** every domain entity extends `TenantOwnedEntity` (adds `organization_id`).
  New services should extend `TenantScopedService` (auto-filters reads + stamps `organization_id`),
  and read the current org via `TenantContext.requireOrganizationId()`. RLS is enabled as defense-in-depth.
- **RBAC (fine-grained):** controllers use `@UseGuards(JwtAuthGuard, PermissionsGuard)` +
  `@RequirePermissions('<feature>.<action>')` (e.g. `work-orders.execute`); never hardcode role
  names — custom roles exist. The permission catalog (features × actions + system-role defaults)
  lives in `backend/src/rbac/permission-catalog.ts` — register new features/actions there.
  Roles are DB records: immutable org-less **system roles** (admin `*`, manager, supervisor,
  operator; permissions from the catalog) + per-organization **custom roles** (grants in
  `role_permission_grants`, managed via `/api/rbac/roles`, UI at `/rbac`). `GET /api/auth/permissions`
  returns the caller's `{ role, permissions[] }`; web (`PermissionsService.can/canView/canManage`,
  `featureGuard('<feature>')`) and mobile (`config/permissions.ts`) gate on that set (wildcard-aware).
  **Platform vs tenant:** catalog features flagged `platform: true` (organizations) are excluded
  from the tenant `*` wildcard, ungrantable to custom roles, and held only by the org-less
  `platform-admin` system role (seed login `platform@pcs.com`) — a tenant admin can never manage
  other tenants or grant platform-admin. `POST /api/organizations` accepts an `initialAdmin`
  block to bootstrap a new tenant's first admin transactionally. Role/user/org mutations are
  written to the audit log. Regression suites: `npm run test:rbac` (catalog unit tests) and
  `npm run test:rbac:e2e` (62-assertion live suite, needs a freshly seeded API).
  The old `@Roles`/RolesGuard + `auth/permissions.config.ts` are deprecated shims — don't add usages.
- **TypeORM:** enum columns use `type: 'enum'` (TypeORM names the PG type `"<table>_<column>_enum"`);
  numeric columns use the `numericTransformer` so they come back as `number`, not string.
- **Migrations & `synchronize`:** `DB_SYNCHRONIZE` defaults **ON** (including prod) — the schema is
  currently kept in step with the entities by `synchronize`, so adding/changing an entity auto-mutates
  the DB on boot. Migrations in `database/migrations/` are idempotent (guarded `IF NOT EXISTS` /
  `pg_type` / `pg_constraint`); once they're the source of truth, set `DB_SYNCHRONIZE=false` and rely on
  `migrationsRun`. Be deliberate about which DB you boot against (see DB note above).
- **Module cycles:** none today — `projects`, `work-orders` and `shipping` reference each other's
  entities only (via their own `TypeOrmModule.forFeature`), not each other's modules. Keep new
  cross-module deps acyclic where possible.
- **Frontend:** standalone components, lazy `loadComponent` routes in `app.routes.ts`, services under
  `core/services` calling `environment.apiUrl`. Reuse `ThreeViewerComponent` for any 3D model view.
  Add new menu items to `navGroups` in `layout/layout.component.ts`.
- **3D linkage:** `convert-ifc.mjs` names each GLB node by the element **GlobalId**, which equals
  `assembly_nodes.ifc_guid` / `mesh_name` — that's the join key the viewer uses to highlight a part.
