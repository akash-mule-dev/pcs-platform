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
  materials/               # materials / stock
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
- `ImportFile` — an uploaded source file (`conversion_job_id`, `model_id`, status, node_count) plus
  live pipeline telemetry (`stage`, `progress` 0–100, `started/finished_at`, `duration_ms`,
  `created_by_*`, durable `storage_key` for retries). `ImportFileEvent` (`import_file_events`) is
  its append-only stage-transition history (the monitoring timeline; mirrors the ncr_events idea).
- `ProductionOrder` — a per-customer/per-run instance of the project: its own process, quantity
  and status; releasing it creates one WorkOrder per assembly (`WorkOrder.production_order_id`).
- `Shipment` / `ShipmentItem` — shipping loads and the assemblies on them; what's shipped is
  derived from items on shipped/delivered loads (nothing written back onto the tree).
- `WorkOrder.assembly_node_id` — the **existing** WorkOrder/WorkOrderStage engine drives each
  fabricated node through a Process's stages (no parallel engine).

Key services & flows:

- **IFC import — async, observable pipeline** (`ifc-import.service.ts`,
  `POST /api/projects/:id/import-ifc`): the upload is stored durably FIRST (StorageProvider
  `import-sources/…` + import_files row), the request returns immediately, then the background
  pipeline runs `uploaded → queued → extracting → persisting → converting → completed|failed`.
  Pipelines run through an in-process **FIFO queue with bounded concurrency**
  (`IMPORT_PIPELINE_CONCURRENCY`, default 2) so "N packages ahead of yours" is real, and
  `onModuleInit` re-queues imports interrupted by a restart from their stored source. Spawns
  `cad-conversion/scripts/extract-ifc-structure.mjs` (web-ifc) → normalized JSON tree →
  persisted into `assembly_nodes` **idempotently by `ifc_guid`** → GLB queued via
  `ConversionService.createJob`. Every transition updates `import_files.stage/progress`, appends
  an `import_file_events` row and emits the room-scoped `import:progress` websocket event
  (rooms: `join-project`/`leave-project`). Conversion progress (55→99%) + completion/failure are
  mirrored onto the import row by `conversion/import-conversion-link.service.ts` inside the
  processor (works inline + BullMQ, survives API restarts; entity-only cross-module dep).
  Monitoring API: `GET :id/imports` (history), `GET :id/imports/:importId` (timeline + conversion
  snapshot), `POST :id/imports/:importId/retry` (failed only; conversion-only or full re-run from
  the stored source); **org-wide** `GET /api/imports/monitor` (active pipelines with queue
  position + KPI counts) and `GET /api/imports/history` (project filter, sort, paging) in
  `import-monitor.service/controller.ts`. `linkPendingModels` / `POST :id/resolve-models` remain
  as the healing path. Web UI: tenant-wide **Package Monitor** page at `/package-monitor`
  (in-progress tab with queue positions + live %, history tab with filters; nav item + projects
  header button; the wizard routes there after an upload) and the per-project **Monitoring** tab
  (live stage stepper + per-import event timelines), live header pipeline bar; regression suite
  `npm run test:e2e:imports` (62 assertions incl. ws room isolation; needs a freshly seeded API +
  `socket.io-client` resolvable for the ws checks).
- **Multi-format & ZIP packages** (`package-import-math.ts` pure module, `npm run test:package`):
  the import endpoint accepts IFC, geometry-only CAD/mesh formats (STEP/IGES/GLB/OBJ/STL/…,
  converted to GLB without structure extraction) and **ZIP coordination packages** (Tekla/SDS2
  exports: model + PDF drawings + .kss). Packages are unpacked + classified, every IFC builds the
  tree, the largest model drives the GLB, and drawings/certs are stored as `assembly_documents`
  with **piece-mark filename matching** ("B101 - Rev 0.pdf" attaches to mark B101; unmatched stay
  project-level, junk skipped). `GET :id/documents?importId=` lists a package's contents (shown in
  the Monitoring import detail). Unsupported extensions are rejected at upload with the accepted list.
- **Production orders** (`production-order.service.ts`, `POST /api/projects/:id/orders`,
  `/api/orders/:id/*`): create-and-release transactionally generates per-assembly WorkOrders +
  stages with count totals (`quantity-math.ts`: `qtyDone`/`qtyTotal` per stage). The board
  (`GET /api/orders/:id/stage-board`) and progress (`GET /api/orders/:id/progress`) are
  count-based roll-ups scoped to that order.
- **Stage kanban** (`work-orders.service.ts#kanban`, `GET /api/work-orders/kanban?projectId&orderId&q`):
  org-wide "where is every piece" board fed by the SAME count-based stage rows as the order board —
  columns are the distinct stage names (ordered by sequence), each card is a work order placed at
  its **first incomplete stage** with current-stage qty, overall units/%, NCR + late + quality-gate
  flags. It never reads `work_orders.completed_quantity` (legacy column the count engine doesn't
  maintain — the root cause of the old board's wrong numbers). Web page `/work-orders/kanban`:
  project/order/search filters, per-card `+1` and complete-stage actions (server-gated; cards move
  columns as work is recorded), live via the `stage-update`/`work-order-update` ws events.
  Regression suite `npm run test:e2e:kanban` (21 assertions; freshly seeded API).
- **Revision management** (`revision-diff.ts` pure module + `npm run test:revision`): every import
  captures an added/changed/missing diff vs the prior tree (stored on `import_files.revision`,
  summarized in the event timeline). `GET :id/imports/:importId/revision` enriches it with
  **production impact** per affected piece (work orders touching it via ancestor rollup, units
  done, shipped qty → severity critical/high/medium/none) — the change-order report. Shown in the
  Monitoring tab's import detail.
- **Earned value / progress billing** (`project-insights.service.ts`,
  `GET :id/earned-value?orderId=`): weekly produced tonnage (WOs completed × node weight) +
  shipped tonnage (shipped/delivered loads) with cumulative %, scoped to released orders —
  web "Reports" tab with chart + CSV export.
- **Per-piece extras**: `assembly_documents` (shop drawings etc., PDF/PNG/JPEG/WebP ≤20 MB via
  StorageProvider; CRUD under `:id/nodes/:nodeId/documents`, stream at `:id/documents/:docId/file`)
  and `piece_lot_assignments` (heat-number traceability: assign `material_lots` to nodes,
  `GET :id/shipments/:shipmentId/traceability` = MTR rollup incl. descendants + coverage gaps).
  Both editable from the Assemblies tab's detail panel; MTR per load on the Shipping tab.
- **Delivery note / packing slip** (`shipping.service.ts#deliveryNote`,
  `GET /api/shipments/:id/delivery-note?heats=`): structured packing-slip data (org+project
  header, itemized assemblies with mark/profile/grade/qty/weight, totals, optional heat-number
  appendix via descendant rollup). The web renders it in a print-optimized popup → browser
  "Save as PDF" (the repo's document convention; no server PDF lib). "Delivery note" button per
  load on the Shipping tab.
  Regression suite `npm run test:e2e:projects` (30 assertions; freshly seeded API).
- **Design summary** (`project-progress.service.ts` + pure `progress-math.ts`,
  `GET /api/projects/:id/progress`): node composition + total tonnage + work-order item count —
  feeds the workspace header and the portfolio list (`GET /api/projects/summary`).
- **Shipping gate** (`shipping.service.ts`): an assembly can be loaded once it has
  production-complete units (every non-skipped stage done across its work orders), no open NCRs,
  and unallocated quantity left; shipped totals come from shipment items.

## The costing & inventory module (`materials`, `costing`, `projects/material-planning`)

End-to-end flow: **import IFC → per-unit material requirement (BOM) → one-click material
masters → receive stock (moving average) → order requirement ×qty + coverage → issue/return
against the order → costs roll up (WO → order → project → org).**

- **Inventory valuation is MOVING AVERAGE** (`materials/inventory-math.ts`, pure + unit-tested):
  a receipt with a `unitCost` re-averages `materials.unit_cost` over total on-hand; every
  movement **stamps `stock_movements.unit_cost` at movement time** — costing reads the ledger,
  never today's price. All stock mutations run in one transaction with pessimistic locks on the
  stock + material rows (insert-then-lock on the unique index for first movers). Movement types:
  receipt / issue / scrap / adjustment / **return** (issue reversal) / reserve / release.
  `GET /api/inventory/summary` is the one-call UI overview (on-hand, avg cost, value, low-stock).
- **BOM = the assembly tree** (`projects/material-requirements-math.ts`, pure): part nodes
  grouped by normalized `(profile, material_grade)` → per-unit lines (pieces, Σlength, Σweight).
  A material master **matches a line by the same normalized pair** (`materials.profile` +
  `material_grade` columns); `requiredQty` is expressed in the material's UoM (kg/m/ea/t,
  unknown → kg). `POST /api/projects/:id/material-requirements/sync-materials` creates missing
  masters (code from profile+grade, kg, cost 0). Order requirement = per-unit × `order.quantity`,
  plus net issued (issues+scrap−returns by `stock_movements.production_order_id`), remaining,
  and stock coverage status (`unmapped | covered | short | issued`); off-BOM issues are listed
  as extras. Endpoints in `material-planning.controller.ts` (own module — exports
  `MaterialRequirementsService`, entity-only deps, imported by CostingModule; keep acyclic).
- **Costing** (`costing/costing-math.ts`, pure): `total = material + labor + overhead`.
  Material = stamped ledger consumption. Labor = `(duration − break) × rate` with per-entry
  rate resolution **worker (`users.hourly_rate`) → stage (`stages.hourly_rate`) → org default**;
  overhead = % on labor. Estimates: BOM × current avg costs and `stages.target_time_seconds ×
  qty_total × (stage rate | default)` — actual vs estimate everywhere. Settings live in
  `organizations.settings.costing` (`{defaultLaborRate, overheadPercent, currency}`, legacy
  `settings.laborHourlyRate` honored) via `GET/PUT /api/costing/settings` (audited;
  `costing.manage` permission). Cost endpoints (all SQL aggregates, org-scoped, never N+1):
  `/api/costing/work-order/:id` (+per-worker), `/order/:id` (per-assembly + per-material +
  variance), `/project/:id`, `/orders` (org overview). Issues/returns validate refs belong to
  the org; a work-order ref auto-stamps its production order; consumption against
  completed/cancelled orders is rejected (returns stay allowed).
- **Web:** Inventory page (`/materials`: avg cost/value/low-stock, receive with live new-avg
  preview, return, adjust, per-material ledger), project **Materials** tab (per-unit BOM +
  coverage + sync button), order **Materials** tab (×qty, one-click issue prefilled with
  min(remaining, on-hand), issue history + returns) and **Costs** tab (actual-vs-estimate cards,
  per-assembly/per-material breakdowns, settings inline), org `/costing` overview. Rates are
  edited on the user form (admin) and the stage dialog.
- **Regression suites:** `npm run test:costing` (3 pure suites, 35 assertions) and
  `npm run test:e2e:costing` (50-assertion live suite: BOM→sync→moving average→order scaling→
  issue guards→rate chain→overhead→roll-up agreement→closed-order guard; freshly seeded API +
  `E2E_PG_URL` — the demo IFC has no part weights, the suite backfills them via SQL).

## The quality module (`quality-data`, `quality-ncr`, `quality-reports`, `spc`, `quality-notify`)

End-to-end QA flow: **record inspection (web 3D / mobile AR / per-node) → auto-fail on
out-of-tolerance → failed entries queue for sign-off → raise NCR → investigate → disposition →
close (or CAPA) → gates lift** (work-order quality stages + shipping both block on open NCRs).

- **Pure rule modules** (unit-tested, no Nest/TypeORM): `quality-data/quality-math.ts`
  (tolerance evaluation + auto-fail + sign-off rules), `quality-ncr/ncr-workflow.ts`
  (NCR/CAPA state machines), `work-orders/qc-gate.ts` (stage gate incl. inspection rules) and
  `spc/spc-math.ts` (XmR charts + Western Electric rules). `npm run test:quality` runs all four.
- **Stage quality gates** (work-orders + order bulk/board paths): a quality-named stage cannot
  COMPLETE while the assembly has (1) open NCRs, or (2) failed inspections not yet signed off
  (approve = formal concession); a stage flagged `stages.requires_inspection` (hold point — set
  in the stage dialog) additionally needs ≥1 acceptable inspection recorded. Audit endpoints
  return `gateBlocked` + human `gateReason` per stage row for pre-warn chips/tooltips.
- **Rework verification:** closing an NCR dispositioned `rework` that is pinned to an assembly
  requires a passing re-inspection recorded AFTER the disposition (`ncrs.dispositioned_at`).
- **Concurrency & idempotency:** NCR PATCHes accept `expectedVersion` (409 on mismatch — web +
  mobile reload on conflict); quality-data creates accept a `clientKey` uuid so offline-queue
  replays return the original row (unique `(org, client_key)`), and the mobile AR queue retries
  failed evidence uploads as separate queue items.
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
- **Evidence uploads** (`POST /quality-data/:id/evidence`, `POST /ncr/:id/evidence`) accept
  JPEG/PNG/WebP only (≤10 MB); web fetches them as authed blobs. Rejecting a sign-off offers a
  pre-filled "Raise NCR" on web + mobile AR; the web NCR detail has a print view (browser → PDF).
- **Analytics:** `GET /quality-data/insights` (FPY, NCR aging/time-to-close, defect Pareto —
  web page `/quality-insights`); `GET /spc/control-chart` returns a characteristics picker
  without `meshName`, else an XmR chart (σ from average moving range, WE rules 1–4, Cp/Cpk).
- **Regression suites:** `npm run test:quality` (pure rules), `npm run test:e2e:quality`
  (80-assertion live suite: identity, workflow, gates, rework loop, idempotency, versioning,
  evidence, SPC/insights, tenant isolation — scratch DB, mirrors `test:e2e:orders`),
  plus `tests/suite/11-quality-data.api.spec.ts` and `tests/phase6-quality-enhancements.api.spec.ts`.

Front end: `/projects`, `/projects/:id` workspace tabs (Overview / Assemblies & 3D / Work Orders /
Monitoring); production tracking lives inside each order at
`/projects/:id/orders/:orderId/(board|progress|quality|shipping)`.
Import progress is live: the `ProjectWorkspaceStore` joins the `project:<id>` socket room
(`RealtimeService.joinRoom`, re-joined on reconnect) and falls back to 5s polling of
`GET :id/imports` while anything is active — uploads show browser→server % first, then the
pipeline % end-to-end (header bar, Monitoring tab, assemblies empty-state).

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
  returns the caller's `{ role, permissions[] }` with wildcards EXPANDED server-side to concrete
  catalog keys (the tenant `*` excludes platform features) — clients must never re-interpret
  wildcard semantics themselves (that bug once showed the Organizations sidebar to tenant admins);
  web (`PermissionsService.can/canView/canManage`, `featureGuard('<feature>')`) and mobile
  (`config/permissions.ts`) gate on that set.
  **Platform vs tenant:** catalog features flagged `platform: true` (organizations) are excluded
  from the tenant `*` wildcard, ungrantable to custom roles, and held only by the org-less
  `platform-admin` system role (seed login `platform@pcs.com`) — a tenant admin can never manage
  other tenants or grant platform-admin. `POST /api/organizations` accepts an `initialAdmin`
  block to bootstrap a new tenant's first admin transactionally.
  **Support impersonation:** `organizations.impersonate` (platform) — `POST /api/organizations/:id/impersonate`
  mints a 30-min JWT scoped to the tenant as its admin, carrying `impersonation:true`/`impersonatedBy`
  (so it's audited + bannered, still platform-blocked); web stores it over a backed-up platform token
  with an Exit banner (`AuthService.start/stopImpersonation`). Live suite `npm run test:support:e2e`.
  **Company self-service:** tenant feature `company` (`view`=manager/supervisor, `manage`=admin);
  `GET/PATCH /api/company` operate on the caller's OWN org (name/description + `settings.profile`),
  audited as entityType `company`, platform org guarded; web page `/company`.
  Role/user/org mutations are
  written to the audit log. Regression suites: `npm run test:rbac` (catalog unit tests) and
  `npm run test:rbac:e2e` (62-assertion live suite, needs a freshly seeded API).
  The old `@Roles`/RolesGuard + `auth/permissions.config.ts` are deprecated shims — don't add usages.
- **Shared library / "super company"** (`backend/src/library`): a single platform organization
  (`organizations.kind = 'platform'`, slug `platform`, created idempotently by `LibraryBootstrapService`)
  OWNS master default processes + form templates (incl. NCR/inspection). Platform admins stay org-less;
  the platform org is purely a content home (hidden from `GET /organizations`, uneditable as a tenant).
  **Publish = copy**: `POST /api/library/{processes,templates}/:id/publish {organizationId|allTenants}`
  copies into tenants, idempotent by `processes/form_templates.library_origin_id` (re-publish updates
  in place; stages reconciled by sequence, never deleted → no work-order FK breakage). New tenants are
  auto-seeded with the whole library by `OrganizationService.create` (best-effort). Gated by the
  platform-scoped `library` feature (`view`/`manage`/`publish`), held only by `platform-admin`; web page
  `/library`. Pure copy logic + defaults in `library/library-content.ts` (`npm run test:library`);
  live suite `npm run test:library:e2e` (20 assertions).
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
