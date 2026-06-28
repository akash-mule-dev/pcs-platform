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
- **Pipeline worker (only if `REDIS_URL` is set):** `cd backend && npm run worker`
  (`node dist/conversion/worker.js`) — drains BOTH BullMQ queues: `pcs-import` (the import
  pipeline) **and** `pcs-conversion` (GLB conversion). With no `REDIS_URL` both run **inline** in
  the API process, so the worker isn't needed in plain dev. In the deployed env the API is a pure
  producer and this worker (on Railway) does the heavy lifting — see `docs/PIPELINE-DEPLOY.md`.

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
  storage/                 # pluggable StorageProvider (vercel-blob default | azure — NO local disk), STORAGE_TYPE env
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
  shared/components/three-viewer/  # reusable three.js GLB viewer (modelUrl, highlightNames, meshClicked,
                                   #   showTools+referenceLengths for measure/dimensions, colorOverlay for data overlays)
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
  The pipeline runs in one of **two modes**, chosen by `resolveQueueDriver()` (`projects/queue/`):
  **inline** (default, no `REDIS_URL`) keeps an in-process **FIFO queue with bounded concurrency**
  (`IMPORT_PIPELINE_CONCURRENCY`, default 2) so "N packages ahead of yours" is real, and
  `onModuleInit` re-queues imports interrupted by a restart from their stored source; **bullmq**
  (`REDIS_URL` / `CONVERSION_DRIVER=bullmq`) makes the API a pure **producer** — `dispatchPipeline`
  enqueues a durable `pcs-import` job (dedup by `importFileId`, 3 attempts) and returns, a
  long-running **worker** (`npm run worker`, `runImportJob` entry) consumes it, and the
  `onModuleInit` recovery sweep is skipped (BullMQ owns recovery — no double-processing). This
  hybrid is what lets a serverless API survive the heavy work: deployed as **Vercel producer →
  Upstash Redis → Railway worker** with instant rollback by dropping `REDIS_URL`
  (`docs/PIPELINE-DEPLOY.md`). Either way the worker spawns
  `cad-conversion/scripts/extract-ifc-structure.mjs` (web-ifc) → normalized JSON tree →
  persisted into `assembly_nodes` **idempotently by `ifc_guid`** → GLB queued via
  `ConversionService.createJob`. Every transition updates `import_files.stage/progress`, appends
  an `import_file_events` row and emits `import:progress` on the owning tenant's **`org:<id>`
  channel** (`emitToOrg`; clients auto-join that room from their JWT on connect, the workspace
  store filters by `projectId`), so it streams live over **both** Ably (serverless API + the
  Railway worker) and in-process Socket.IO (dev) — replacing the old Socket.IO-only `project:<id>`
  room that only worked locally. Conversion progress (55→99%) + completion/failure are
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
- **Costing** (`costing/costing-math.ts`, pure): `total = material + labor + machine + overhead`.
  Material = stamped ledger consumption. Labor = `(duration − break) × rate` with per-entry
  rate resolution **stamped `time_entries.labor_rate` → worker (`users.hourly_rate`) → stage
  (`stages.hourly_rate`) → org default**. The labor rate is **FROZEN at clock-out** onto
  `time_entries.labor_rate` (worker/stage only — the org default stays a live read-time fallback,
  so setting it later still flows to un-rated entries), the labor analog of
  `stock_movements.unit_cost`, so a later rate change never rewrites historical labor cost. The
  per-WO view splits clocked labor into **productive / setup (`time_entries.is_setup`) / rework
  (`is_rework`) / idle (`idle_seconds` overlay)** (`splitLabor`). **Machine = attended station time
  × the work-center rate** — `stations.machine_rate` (the costing driver; `equipment.hourly_rate`
  is asset-level only, a hint for setting it), FROZEN onto `time_entries.machine_rate` at clock-out
  (`COALESCE(machine_rate, station's live rate)`); machine ESTIMATE = `stages.machine_time_seconds
  × qty_total × stages.machine_rate` (`machineByKey` / `machineEstimateByWorkOrder`). Work driven
  purely from the order board / kanban (counts, no clock-in/out) would otherwise read $0 labor +
  machine, so an **earned-standard proxy** (labor: `stage target × qty_done × stage|default rate`;
  machine: `stage machine time × qty_done × stage machine rate`) is added for in-progress/completed
  stages with NO time entries (`proxyByKey`, flagged estimated, consistent across
  WO/order/project/overview roll-ups). Overhead = **per-stage % on labor** (`stages.overhead_percent`
  → org default; each stage's labor × its own burden, so welding ≠ painting — `overheadByKey` on
  clocked labor + the proxy/estimate carry their own; `composeTotals` takes the explicit per-stage
  amount). **Material is per-WO too**: directly
  PINNED consumption (`stock_movements.work_order_id`) PLUS an ALLOCATED share of the order-level
  bulk issues (no WO pin), spread across the WOs by their **per-WO BOM estimate** → subtree weight →
  equal (`MaterialRequirementsService.bomEstimateByNode` walks each WO assembly node's part subtree;
  `costing.service#materialAllocation` + pure `allocateProportionally` split it penny-exact). The
  order's headline material is unchanged (bulk is redistributed, not invented): items expose
  `materialCost` (pinned) + `allocatedMaterialCost` + `estimatedMaterialCost`, and
  `unattributedMaterialCost`/`allocatedMaterialTotal` show how much bulk got spread. Estimates: BOM ×
  current avg costs (per WO via the node subtree, per order via the whole tree) and
  `stages.target_time_seconds × qty_total × (stage rate | default)` — actual vs estimate everywhere. Settings live in
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

## The quality module (`quality-data`, `quality-reports`, `spc`, `quality-notify`)

End-to-end QA flow: **record inspection (web 3D / mobile AR / per-node) → auto-fail on
out-of-tolerance → failed entries queue for sign-off**, and separately **raise an NCR (a
template-driven QC report) → investigate → disposition → verify correction → close → gates lift**
(work-order quality stages + shipping both block on open NCRs). There is ONE report system — the
standalone `quality-ncr` module + `ncrs`/`capas`/`ncr_events` tables were retired
(`RetireNcrModule` migration); CAPA is gone.

- **An NCR IS a `QualityReport` whose `template_type === 'ncr'`** (`quality-reports/`). It is
  created from an `ncr`-type FormTemplate via the normal report flow (web Report Templates → fill
  on `/qr/:id` → reflects in QC Reports; the mobile app opens the same `/qr/:id` page in a WebView,
  so it inherits the whole lifecycle UI). The seeded library NCR template
  (`library/library-content.ts`) carries defectType/severity/description/quantityAffected/rootCause.
- **NCR lifecycle** (pure state machine `quality-reports/ncr-workflow.ts`, `npm run test:quality`):
  `open → under_review → dispositioned → closed` (+ `cancelled`, + reopen). The shipping +
  quality-stage GATES are keyed on `quality_reports.resolved_at IS NULL` (unchanged); only CLOSE
  and CANCEL stamp `resolved_at`, so `ncr_status` adds the richer state without touching any gate
  query. Endpoints (all on `/api/quality-reports/:id/*`): `disposition` (record/revise the
  Material-Review decision), `resolve` (close), `reopen`, `cancel`, `comment`, `start-review`,
  `GET :id/events` (timeline). Lifecycle columns live on `quality_reports`
  (`ncr_status`, `disposition`, `disposition_notes/by/at`, `root_cause`, `corrective_action`) +
  the additive `NcrLifecycle` migration.
- **Disposition** ∈ `rework | repair | use_as_is | scrap | return_to_supplier` (ISO 9001 §8.7
  Material Review). **Closing REQUIRES a disposition**, and a correction (`rework`/`repair`)
  additionally requires a **passing re-inspection recorded AFTER the disposition** — a `quality_data`
  `pass` for the assembly with `created_at > disposition_at` (ISO §8.7.1 "verify the correction").
- **Activity log:** every transition + comment appends a `quality_report_events` row (append-only;
  author resolved to a display name on read). `GET :id/events` is the timeline the fill page renders.
  RLS-enrolled by the `NcrLifecycle` migration.
- **RBAC:** filling/submitting/commenting = `quality-reports.update` (manager/supervisor/operator);
  deciding disposition + close/reopen/cancel = **`quality-reports.disposition`** (manager/supervisor
  only) — "report it" is separated from "decide its fate". `quality-reports.create` raises NCRs.
- **Stage quality gates — TWO gates, per stage** (`work-orders/qc-gate.ts` pure module → all
  work-orders + order bulk/board call sites; `npm run test:quality`). QC is per operation AND
  consolidated at a release step (the fabrication-industry model: ITP hold points + final QC):
  - **FINAL QC stage** (`stages.is_final_qc`) — the terminal release gate. Cannot COMPLETE while the
    assembly has ANY open NCR (raised at any stage), any failed inspection not signed off, or (if a
    hold point) no acceptable inspection — all evaluated assembly-wide (the **rollup**). Completing
    it releases the piece; shipping also blocks on any open NCR. `ProcessesService.create` +
    `ensureStandard` + the library seed **auto-append** a `Final QC` stage that is `is_final_qc`
    only — a release gate, **NOT a hold point** (it blocks on open NCRs / unsigned failures but does
    NOT force a positive inspection; `RelaxFinalQcHold` migration backfilled existing gates off the
    old `+hold` default). Make a process's final QC a mandatory-inspection hold by flagging the stage
    `inspection_type='hold'`. Opt out of the auto-append with `appendFinalQc:false` or by flagging
    your own stage `isFinalQc`.
  - **HOLD point** (`stages.inspection_type='hold'`, opt-in per stage) — an in-process gate that
    blocks ITS OWN stage only, scoped by `stage_id`. Witness/review + plain stages never block.
  - `is_final_qc` is **tri-state**: `true`=explicit gate, `false`=explicitly not, `null`=legacy →
    fall back to the `isQualityStageName` name regex (so pre-existing "Quality Check" stages keep
    gating). `isFinalQcStage()`/`stageQcGateError()` are the single source of truth — **never** gate
    on the name regex directly. The `QcStageScoping` migration adds the columns and backfills each
    process's terminal quality-named stage to `is_final_qc=true`.
  - **NCRs + inspections carry the operation** (`quality_reports`/`quality_data`.`stage_id` +
    `work_order_stage_id`): the final-QC rollup counts all of an assembly's NCRs; a hold point counts
    only its own stage's. An NCR with no `stage_id` (legacy / assembly-level / mobile) counts toward
    the rollup but never a per-stage hold. Set from the order Quality tab's stage picker; NCR-from-
    inspection inherits it. Audit endpoints return `gateBlocked` + human `gateReason` per stage row;
    `GET orders/:id/nodes/:nodeId/audit` also returns a `finalQc` rollup (`releasable`, per-stage open
    NCRs) for the web audit's Final-QC release cockpit.
- **Identity is server-stamped:** `inspector`/`inspectorUserId` default from the JWT on create;
  `PATCH /quality-data/:id/signoff` ignores client `signoffBy` and stamps it from the authed user
  (needs `quality-analysis.signoff`). NCR disposition/close authority is the JWT user
  (`disposition_by`/`resolved_by`) — the ISO §8.7.2 "authority responsible".
- **Idempotency:** quality-data creates accept a `clientKey` uuid so offline-queue replays return
  the original row (unique `(org, client_key)`); the mobile AR queue retries failed evidence uploads.
- **Numbering is per-organization** (`QR-YYYY-NNNN`, shared by NCRs + QC reports) with a unique
  `(organization_id, number)` index; allocation races retry on 23505.
- **Tenancy:** every quality read/write is org-scoped; linked records (model/node/project/WO) are
  validated to belong to the caller's org. `quality_reports` + `quality_report_events` are RLS-enrolled.
- **Eventing** (`quality-notify/`): failed inspections emit the `quality-alert` websocket event;
  high/critical failures notify the org's admin/manager/supervisors; sign-off decisions notify the
  inspector. Best-effort (never fails the write).
- **Evidence uploads** (`POST /quality-data/:id/evidence`) accept JPEG/PNG/WebP only (≤10 MB), fetched
  back as authed blobs. The web `/qr/:id` page has a print → PDF view.
- **Analytics:** `GET /quality-data/insights` (FPY, NCR aging/time-to-close excluding cancelled,
  defect Pareto — web `/quality-insights`); `GET /spc/control-chart` returns a characteristics picker
  without `meshName`, else an XmR chart (σ from average moving range, WE rules 1–4, Cp/Cpk).
- **Regression suites:** `npm run test:quality` (pure rules), `npm run test:e2e:quality`
  (80-assertion live suite: identity, workflow, gates, rework loop, idempotency, versioning,
  evidence, SPC/insights, tenant isolation — scratch DB, mirrors `test:e2e:orders`),
  plus `tests/suite/11-quality-data.api.spec.ts` and `tests/phase6-quality-enhancements.api.spec.ts`.

Front end: `/projects`, `/projects/:id` workspace tabs (Overview / Assemblies & 3D / Work Orders /
Monitoring); production tracking lives inside each order at
`/projects/:id/orders/:orderId/(board|progress|quality|shipping)`.
Import progress is live: the `ProjectWorkspaceStore` subscribes to `import:progress` (delivered on
the auto-joined `org:<id>` channel over both Ably + Socket.IO) and filters by `projectId`, with a
5s polling fallback of `GET :id/imports` while anything is active — uploads show browser→server %
first, then the pipeline % end-to-end (header bar, Monitoring tab, assemblies empty-state).

**3D viewer — measurement + data overlays** (`shared/components/three-viewer`, opt-in inputs so
read-only embeds are unchanged): on the Assemblies tab the viewer offers an in-canvas toolbar
(`[showTools]`) for **point-to-point distance** + **bounding-box L×W×H dimensions**, labelled in
real **mm**. Real units are recovered by **auto-calibration in WORLD space**: the GLB carries the
IFC's native units AND is auto-scaled to fit (plus a baked node scale), so a world unit has no fixed
size — the viewer derives `mmPerWorldUnit` from `[referenceLengths]` (a part's `length_mm` vs its
longest geometry edge × world scale, median over linear members; CSS2DRenderer labels). Never convert
via the fit-scale. The viewer also takes a generic **`[colorOverlay]`** (`{colors:{meshName→hex},
legend}`) that paints meshes + shows a legend — the reusable primitive behind the Assemblies "Color
by" control: **profile / grade** (from loaded node data), **production status** (Not started / In
production / Complete / Shipped — from the count-based kanban `GET /work-orders/kanban?projectId&includeAllDone`
joined by `assemblyNodeId`, propagated to descendant part meshes; shipped from project shipments) and
**latest changes** (added/changed from `importRevision`). `meshName == ifc_guid` is the join key for
every overlay; status colors live on assemblies so they're applied to each assembly's descendant
meshes. Clicking a part in production mode surfaces its status + a link to the order board.

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
  **Customer support** (`backend/src/support`): a two-sided ticketing system. Customers (tenant
  feature `support` = view/create/comment, all roles) raise tickets from a global Help modal
  (toolbar) or `/support`; platform staff triage cross-tenant from `/support-desk` (platform
  feature `support-desk` = view/manage). `support_tickets` (tenant-owned, global `TKT-YYYY-NNNN`,
  status/priority/category/assignee) + `support_ticket_messages` (customer/support/system authors,
  `internal` notes hidden from customers, optional `attachments` storage-key array). Pure state
  machine in `support/support-workflow.ts` (`npm run test:support-tickets`): customer reply reopens
  pending/resolved/closed→open, support reply advances open→in_progress, `canTransition` guards desk
  status changes. **Attachments** (image/PDF ≤10 MB via the shared `StorageProvider`, keyed
  `<org>/support/<ticketId>/…` through `StorageKeys.supportAttachment`): `POST :id/attachments`
  (multipart `file` + optional `body`/`internal`) posts a message carrying the file; streamed back as
  authed blobs at `…/messages/:messageId/attachments/:index` (customer path org-scoped + refuses
  internal-note files; desk path sees all). **Triage is concurrency-safe**: `PATCH` accepts
  `expectedVersion` (409 on mismatch, like NCRs) and assignment is validated to the platform-staff
  pool (`GET /support-desk/agents`; a ticket can never be assigned to a tenant user). **Real-time
  is ws both ways** via `EventsGateway.emitSupportEvent`, which fans a single metadata-only
  `support:changed` signal (id/number/status/action — never message bodies) to two **token-scoped**
  rooms: `support-org:<orgId>` (the org comes from the handshake JWT, so a client only ever joins
  its OWN tenant) and `support-desk` (joined only by org-less platform operators). The gateway
  verifies the handshake JWT (`WebsocketModule` registers `JwtModule`; the web client sends it via
  `io(..., { auth })`); recipients reload their list + re-fetch the open thread through their own
  permission-scoped endpoint, so internal notes never leave the API. Best-effort in-app
  notifications too; all actions audited (entityType `support_ticket`). RLS for the support tables is
  enrolled by the `SupportTicketsRls` migration (the generic `TenantRls` ran before they existed).
  Live suite `npm run test:support-tickets:e2e`
  (~33 assertions incl. agents, assignment guard, version conflict, attachment visibility).
  `SupportService` is shared by `SupportController` (org-scoped) + `SupportDeskController`
  (cross-tenant, org-less platform caller). Role/user/org mutations are
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
- **File storage — blobs NEVER live in Postgres, and NEVER on local disk.** Every uploaded
  artifact (IFC/ZIP import sources, GLB models, shop drawings, thumbnails, QA evidence,
  coordination files) goes through the `StorageProvider` (`storage/`) into REMOTE object storage;
  Neon only ever stores the `storage_key`/`file_name` pointer (varchar). There is **no local-disk
  provider** — `STORAGE_TYPE` is `vercel-blob` (default) | `azure`. **Dev/prod use
  `vercel-blob`** (`providers/vercel-blob-storage.provider.ts`) — durable Vercel Blob, keyed by
  pathname like Azure Blob, token from `PCS_DEV_BLOB_READ_WRITE_TOKEN` (or `BLOB_READ_WRITE_TOKEN`).
  Bytes already in memory (a freshly uploaded package, ZIP-extracted drawings) go straight to the
  store via `storage.uploadBuffer(buffer, key, mime)` — they never touch disk. Temp files under
  `os.tmpdir()` are only transient scratch for the spawned extractor/converter (which need a file
  path) and are always cleaned up. **Key layout is tenant-partitioned and centralized in
  `storage/storage-keys.ts` (`StorageKeys`) — never hand-write key strings.** Every blob lives
  under its org: `<orgId>/{imports,documents,models,conversions,quality/{evidence,ncr},coordination,media}/…`
  (`media/` is the future home for screenshots/videos). GLBs are `<org>/models/<id>.glb`, thumbnails
  `<org>/models/<id>/thumbnail.png`. Conversion is org-aware end-to-end: `conversion_jobs.organization_id`
  is stamped at creation so the background processor/BullMQ worker writes the GLB under the right
  tenant and dedupe stays org-scoped. Legacy flat keys (pre-layout) still resolve because the DB
  stores the exact key; only new writes adopt the layout (no migration). Unit test: `npm run test:storage`. The PCS store is **private**, so files are streamed back through
  the API (`download → pipe`, e.g. `GET /api/models/:id/file`) via the server-side token, never a
  public URL. Original packages are re-downloadable: `GET /api/projects/:id/imports/:importId/source`
  (Monitoring tab + Package Monitor history have a download button). Round-trip check:
  `node scripts/verify-blob.cjs` (needs the token in env). Note: on Vercel, the serverless request
  body cap (~4.5 MB) limits server-proxied uploads — for packages above that, upload the client
  straight to Blob and hand the backend the key.
- **Frontend:** standalone components, lazy `loadComponent` routes in `app.routes.ts`, services under
  `core/services` calling `environment.apiUrl`. Reuse `ThreeViewerComponent` for any 3D model view
  (`[modelUrl]`, `[highlightNames]`, `(meshClicked)`; opt-in `[showTools]`+`[referenceLengths]` for
  measure/dimensions, `[colorOverlay]` for a `{meshName→hex}+legend` data overlay — adding a new
  overlay is ~one `{ifc_guid→color}` map). Add new menu items to `navGroups` in `layout/layout.component.ts`.
- **3D linkage:** `convert-ifc.mjs` names each GLB node by the element **GlobalId**, which equals
  `assembly_nodes.ifc_guid` / `mesh_name` — that's the join key the viewer uses to highlight a part.
