# PCS Platform — MES Build-Out Plan (execution order)

**Mode:** build straight through in priority order; verify builds at the end.
**Conventions for every new module:** tenant-owned entities extend `TenantOwnedEntity`; services extend `TenantScopedService` (auto org-scoping); controllers use `JwtAuthGuard + RolesGuard`; `synchronize` auto-creates tables in dev; production migrations generated at the end.

## Status legend
✅ done · 🟡 partial · ⏳ this build-out

| # | Phase | Scope | Status |
|---|-------|-------|--------|
| 0a | Multi-tenancy foundation | tenant context + scoped base + org on users + migration | 🟡 spine done; rollout to existing modules + RLS deferred to cleanup pass |
| 2 | Materials / BOM / inventory | materials, stock, movements, BOM, shortage gate | 🟡 backend + materials UI done; BOM editor + WO warning UI deferred |
| 3 | Equipment / maintenance + real OEE | machines, downtime, PM plans/orders, downtime-based OEE | ⏳ |
| 4 | Workforce: skills/certs + shifts | skills, certifications, shifts, shift assignment, attendance | ⏳ |
| 6 | Traceability | material lots/heat, output serials, genealogy links | ⏳ |
| 7 | Costing | labor + material roll-up per work order / product | ⏳ |
| 0b | Dynamic RBAC | tenant-defined roles + granular permissions (DB-backed) | ⏳ |
| 0c | Template engine | Form.io builder + per-tenant JSON templates + PDF render | ⏳ |
| 1 | Quality: NCR + CAPA + SPC | NCR lifecycle on templates, CAPA workflow, SPC charts | ⏳ (needs 0c) |
| 5 | Finite scheduling / capacity | load-vs-capacity, time-phased plan / Gantt | ⏳ |

## Priority rationale
Floor-impact first (3 equipment, 4 workforce, 6 traceability, 7 costing are mostly new self-contained modules → fastest correct delivery), then the configurability stack (0b RBAC → 0c templates → 1 quality), then scheduling (5). Foundation rollout (0a across existing modules + Postgres RLS) and the deferred UIs are a cleanup pass once the modules exist.

## Build/test (run at the end, on your machine)
```bash
cd backend && npm run build && npm run migration:run && npm run start:dev
cd frontend && npm run build
cd mobile && npm install && npx tsc --noEmit
```
New tables auto-create via `synchronize` in dev. Re-login after restart (JWT now carries `organizationId`). Then generate production migrations:
`npx typeorm migration:generate -d src/database/typeorm.config.ts src/database/migrations/MesBuildout`
