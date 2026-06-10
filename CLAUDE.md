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
  auth/  rbac/             # JWT auth, guards, permissions.config.ts (feature → roles)
  products/ materials/     # catalog products + BOM / materials / stock
  processes/ stages/       # a Process is an ordered list of Stages (the routing)
  work-orders/             # WorkOrder + WorkOrderStage — the stage-execution engine
  lines/ stations/ workforce/ equipment/ scheduling/ time-tracking/ traceability/ quality-* /
  storage/                 # pluggable StorageProvider (local | s3 | azure), STORAGE_TYPE env
  cad-conversion/          # spawns convert-*.mjs + extract-ifc-structure.mjs (web-ifc / assimp)
  conversion/              # async 3D→GLB pipeline: ConversionJob + queue (inline|BullMQ) + processor
  models/                  # Model3D (GLB) records + file streaming endpoints
  coordination/            # BIM coordination packages + drawings
  projects/                # ★ fabrication: Project, AssemblyNode tree, ImportFile, IFC import, WO-gen, roll-up, progress
  shipping/                # ★ fabrication: Shipment + ShipmentItem (the shipping list)
frontend/src/app/
  core/services/           # HTTP services (projects.service.ts, shipping.service.ts, conversion.service.ts, …)
  layout/                  # shell + side-nav (navGroups define the menu)
  projects/                # ★ project list, creation wizard, detail (tree + 3D), shipping, progress
  shared/components/three-viewer/  # reusable three.js GLB viewer (modelUrl, highlightNames, meshClicked)
```

## The fabrication module (`backend/src/projects`, `backend/src/shipping`, `frontend/src/app/projects`)

End-to-end flow: **create project → import IFC → assembly tree + 3D → generate work orders →
run stages (live roll-up) → ship → progress dashboard.**

Core data model (one self-referencing tree absorbs every source format):

- `Project` — the job/contract container (org-scoped).
- `AssemblyNode` — **one self-referencing table** (`parent_id`) for the whole structure.
  `node_type` ∈ `group | assembly | subassembly | part`; carries `ifc_guid` (stable key + GLB
  mesh-node name for 3D highlight), promoted fab columns (`mark`, `profile`, `material_grade`,
  `length_mm`, `weight_kg`), a `properties` jsonb bag, a `model_id` link, and roll-up fields
  (`production_status`, `current_stage_id`, `percent_complete`, `qty_complete`, `qty_shipped`).
- `ImportFile` — an uploaded source file (`conversion_job_id`, `model_id`, status, node_count).
- `Shipment` / `ShipmentItem` — shipping loads and the assemblies on them.
- `WorkOrder.assembly_node_id` — added so the **existing** WorkOrder/WorkOrderStage engine drives
  each fabricated node through a Process's stages (no parallel engine).

Key services & flows:

- **IFC import** (`ifc-import.service.ts`, `POST /api/projects/:id/import-ifc`): spawns
  `cad-conversion/scripts/extract-ifc-structure.mjs` (web-ifc) → a normalized JSON node tree →
  persisted into `assembly_nodes` **idempotently by `ifc_guid`**. The GLB is **always** built
  asynchronously via the conversion queue (`ConversionService.createJob`); `linkPendingModels` /
  `POST /api/projects/:id/resolve-models` link the finished GLB back to the nodes.
- **Work-order generation** (`work-order-gen.service.ts`, `POST /api/projects/:id/generate-work-orders`):
  one WorkOrder per assembly/subassembly against a chosen Process, materializing its stages
  (uses a stand-in Product per project so `WorkOrder.product_id` stays non-null).
- **Status roll-up** (`status-rollup.service.ts` + pure `rollup-math.ts`): a node's status/percent
  comes from its work-order stages; parents aggregate from children; parts inherit their assembly.
  Triggered **live** from `WorkOrdersService.updateStageStatus`/`updateStatus` (branch-scoped:
  `recomputeBranchForNode`) and from shipping; `POST /api/projects/:id/recompute-status` does a full pass.
- **Progress** (`project-progress.service.ts` + pure `progress-math.ts`, `GET /api/projects/:id/progress`):
  status counts, weight-weighted % processed, tonnage (total/processed/shipped), and a per-stage funnel.

Front end: `/projects`, `/projects/:id` (tree + 3D viewer with tree↔mesh highlight),
`/projects/:id/shipping`, `/projects/:id/progress`. The detail page auto-polls `resolve-models`
while a GLB converts so the viewer appears on its own.

## Conventions (follow these)

- **ESM / NodeNext:** the backend uses ESM (NodeNext) module resolution — **relative imports must end
  in `.js`** (e.g. `import { Project } from './project.entity.js'`), even though the source is `.ts`.
- **Multi-tenancy:** every domain entity extends `TenantOwnedEntity` (adds `organization_id`).
  New services should extend `TenantScopedService` (auto-filters reads + stamps `organization_id`),
  and read the current org via `TenantContext.requireOrganizationId()`. RLS is enabled as defense-in-depth.
- **RBAC:** controllers use `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(...)`. Feature → roles
  live in `backend/src/auth/permissions.config.ts` (served to web/mobile); the Angular `featureGuard`
  reads the same config. Register new features there.
- **TypeORM:** enum columns use `type: 'enum'` (TypeORM names the PG type `"<table>_<column>_enum"`);
  numeric columns use the `numericTransformer` so they come back as `number`, not string.
- **Migrations & `synchronize`:** `DB_SYNCHRONIZE` defaults **ON** (including prod) — the schema is
  currently kept in step with the entities by `synchronize`, so adding/changing an entity auto-mutates
  the DB on boot. Migrations in `database/migrations/` are idempotent (guarded `IF NOT EXISTS` /
  `pg_type` / `pg_constraint`); once they're the source of truth, set `DB_SYNCHRONIZE=false` and rely on
  `migrationsRun`. Be deliberate about which DB you boot against (see DB note above).
- **Module cycles:** `projects` ↔ `work-orders` reference each other — broken with `forwardRef(() => …)`
  on both module imports + `@Inject(forwardRef(() => StatusRollupService))`. `shipping → projects`
  and `projects → conversion` are one-way (no `forwardRef` needed). Keep new cross-module deps acyclic
  where possible.
- **Frontend:** standalone components, lazy `loadComponent` routes in `app.routes.ts`, services under
  `core/services` calling `environment.apiUrl`. Reuse `ThreeViewerComponent` for any 3D model view.
  Add new menu items to `navGroups` in `layout/layout.component.ts`.
- **3D linkage:** `convert-ifc.mjs` names each GLB node by the element **GlobalId**, which equals
  `assembly_nodes.ifc_guid` / `mesh_name` — that's the join key the viewer uses to highlight a part.
