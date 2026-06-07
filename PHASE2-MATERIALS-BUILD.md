# Phase 0a (foundation) + Phase 2 (Materials/BOM/Inventory) — Build & Verify

**Date:** 2026-06-06 · Backend only (web/mobile UI is the next increment).

## What was added

**Tenant foundation (Phase 0a — the reusable scoping pattern)**
- `common/tenant/tenant-context.ts` · `tenant.interceptor.ts` · `tenant-owned.entity.ts` (from the previous step)
- `common/tenant/tenant-scoped.service.ts` — base service: every read filtered by org, every create stamped with org. New modules extend it; existing modules migrate onto it next.
- `common/transformers/numeric.transformer.ts` — keeps Postgres `numeric` typed as `number`.

**Materials / BOM / Inventory (Phase 2)** — new `materials/` module, multi-tenant from birth
- Entities: `Material`, `MaterialStock` (on-hand/reserved per location), `StockMovement` (immutable ledger), `BomItem` (product → material).
- Services: `MaterialsService` (material CRUD + BOM), `InventoryService` (receive / issue / scrap / adjust + `checkAvailability`).
- Controllers: `/api/materials`, `/api/bom`, `/api/inventory`.

**Work-order material gate** — `work-orders.service.updateStatus` now blocks a transition to `in_progress` if the product has a BOM and stock is short (returns 400 with the shortage list).

## Build & apply

```bash
cd backend
npm run build                 # or let `nest start --watch` recompile
npm run migration:run         # TenantFoundation: default org + users.organization_id backfill
npm run start:dev             # restart; synchronize auto-creates the new materials tables
```

> Dev relies on `synchronize` to create the new tables. For production, generate a migration once schema is stable:
> `npx typeorm migration:generate -d src/database/typeorm.config.ts src/database/migrations/MaterialsModule`

## Smoke test (Swagger at `/api/docs`, or curl with a Bearer token)

1. **Create a material** — `POST /api/materials` `{ "code":"SS304-2MM", "name":"SS304 sheet 2mm", "type":"sheet", "unitOfMeasure":"sheet", "unitCost":45 }`
2. **Receive stock** — `POST /api/inventory/receive` `{ "materialId":"<id>", "quantity":10 }`
3. **Add a BOM line** for an existing product — `POST /api/bom` `{ "productId":"<productId>", "materialId":"<id>", "quantityPer":2, "scrapPct":5 }`
4. **Check availability** — `GET /api/inventory/availability?productId=<productId>&quantity=10`
   → returns `canRelease`, per-material `required/available/shortage`. (qty 10 × 2 × 1.05 = 21 needed vs 10 on hand → short.)
5. **Gate works** — create a work order for that product (qty 10), then `PATCH /api/work-orders/:id/status { "status":"in_progress" }`
   → **400** `Cannot start work order: insufficient materials in stock` with the shortage list.
6. **Receive more** (`POST /api/inventory/receive` qty 15) and retry step 5 → **succeeds**.
7. **Ledger** — `GET /api/inventory/movements` shows the receipts.

## Status / what's next

- Multi-tenancy is **spine + new module** so far: users carry `organizationId`, the new materials tables are fully tenant-scoped, and the scoping pattern is established. **Existing** modules (products, processes, work-orders, …) still need `organization_id` + scoping rolled on — that's the next foundation increment, then Postgres RLS as hardening.
- Phase 2 **frontend** (materials list, BOM editor, receive/issue screens, and a shortage warning on the work-order release dialog) is the next UI increment.
- Then: 0b dynamic RBAC, 0c Form.io template engine, Phase 1 NCR/CAPA/SPC, and Phases 3–7.
