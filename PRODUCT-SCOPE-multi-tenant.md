# Product Scope — PCS Platform → Multi-Tenant SaaS

**One-liner:** Turn the single-org production-control app into a multi-tenant SaaS where many manufacturing customers share one deployment with hard data isolation, without regressing the existing single-org experience.

**Status key:** ✅ done & verified · 🟡 in progress / delivered-for-apply · ⬜ not started

---

## 1. Problem & context

PCS Platform runs today as a single-organization MES. The business goal ("serve multiple customers") requires that two customers on the same deployment can never see or mutate each other's data — work orders, products, quality records, time entries, etc. Until this pass, only `users` and the newer Phase 1–7 modules carried a tenant key; the core production tables were globally shared, so any second customer would have seen the first's data.

## 2. Goals & non-goals

**Goals**
- Hard isolation of all customer data by `organization_id`, enforced at the database, not just the app.
- Zero regression for the current single-org dataset (the existing 260 work orders etc. stay fully visible to their org).
- A safe, reversible rollout that never takes the live app down.

**Non-goals (this scope)**
- Per-tenant billing, metering, or plan tiers.
- Tenant-level theming / white-labeling.
- Cross-tenant admin/superuser console (beyond a basic org switcher).
- Data residency / per-tenant database separation (we are shared-DB, row-level).

## 3. Target users

- **Tenant operators / supervisors** — only ever see their own org's floor data.
- **Tenant admins** — manage their org's users, roles, templates.
- **Platform operator (us)** — provisions orgs, runs migrations, monitors.

## 4. Success metrics / acceptance

- A user in Org B sees **0** of Org A's records across every list and detail endpoint.
- A write by Org B is stamped Org B and is **rejected by the DB** if it claims Org A.
- Existing single-org users see **no change** (all their data still loads).
- Schema is migration-managed (`synchronize: false`) with a committed baseline.

## 5. Scope — In / Out

| In scope | Out of scope (now) |
|---|---|
| `organization_id` on all core tables | Separate DB per tenant |
| Auto-stamp tenant on write | Billing / usage metering |
| App-level read scoping | White-label theming |
| Postgres RLS backstop + per-request GUC | Cross-tenant analytics |
| Backfill existing rows to a default org | SCIM / SSO provisioning |
| Org/user provisioning basics | Self-serve tenant signup |

## 6. Phased plan, status & acceptance criteria

**Phase A — Tenant data model** ✅
`organization_id` added to the 9 core entities (work orders, work-order stages, products, processes, lines, stations, stages, time entries, quality data); global `beforeInsert` subscriber stamps it from request context; boot backfill assigns pre-existing rows to the default org.
*Acceptance:* every core table has the column; a new record is auto-stamped; existing rows carry the default org. — **Met & verified live** (new product stamped `1958c9f2…`; 260 WOs still visible).

**Phase B — App-level read scoping** ✅
Org filter added to the read paths of products, processes, lines, stations, stages, quality-data, work-orders, time-tracking, and dashboard KPIs (`getOrganizationId() ?? undefined`, so system/background jobs are unaffected and RLS backstops).
*Acceptance:* authed reads return only the caller's org; single-org behavior unchanged. — **Met & verified** (all lists still return the org's full data).

**Phase C — RLS backstop + per-request GUC** 🟡
Postgres Row-Level Security on every `organization_id` table (`USING org = current_setting('app.current_org')`, allow-all when unset for system/migration), plus a request-scoped GUC setter.
*Acceptance:* with RLS on, a forgotten `WHERE` cannot leak across tenants. — **Migration + design drafted; apply + GUC wiring is user-run** (touches prod DB; needs the request-transaction/pooling decision below).

**Phase D — Migration cutover** 🟡
Off `synchronize`, onto committed migrations. Tooling fixed (compiled-JS datasource + SSL), `migrationsRun` gated on `!synchronize`, runbook written (`backend/MIGRATIONS.md`).
*Acceptance:* baseline generated, marked applied on the live DB, `DB_SYNCHRONIZE=false`, app boots clean. — **Tooling + runbook done; baseline generation + apply is user-run.**

**Phase E — Tenant administration** ⬜
Org CRUD, inviting/assigning users to an org, switching org context for the platform operator. Today only a single "Default Organization" exists and is auto-created.
*Acceptance:* platform operator can create Org B and a user in it; that user logs in scoped to Org B.

**Phase F — Mobile parity depth** 🟡
Read-only NCR/Equipment/Materials screens shipped under a "More" tab; create/edit (e.g., raise NCR on the floor), Workforce, and detail screens remain.
*Acceptance:* a tablet user can act on their org's data; runtime-verified on device.

**Phase G — Residual hardening** 🟡
Dashboard aggregates now org-scoped ✅; remaining deep eager `.find()` paths (clockIn/clockOut/getByUser) to harden ⬜ (moot once on migrations + RLS).

## 7. Risks & mitigations

- **RLS + connection pooling (Neon transaction pooler):** session `SET` won't persist; the GUC must be set with `SET LOCAL` inside a per-request transaction. *Mitigation:* wire request-scoped transactions (CLS) or use the session/direct endpoint; validate before enabling. **Decision needed.**
- **`FORCE ROW LEVEL SECURITY` also constrains the table owner** (which the app role is on Neon). *Mitigation:* policy allows-all when the GUC is unset so migrations/bootstrap still run; the app always sets the GUC for authed requests.
- **App-level scoping is per-query and can miss one.** *Mitigation:* RLS is the real guarantee; app-level is the cooperative/perf layer.
- **`synchronize: true` in prod can drop columns on entity change.** *Mitigation:* complete Phase D cutover.

## 8. Open decisions (need product/owner input)

1. **GUC delivery:** request-scoped transactions (CLS) vs. switch the app to Neon's session/direct endpoint? (Affects Phase C effort and connection config.)
2. **Tenant onboarding:** platform-operator-provisioned only, or self-serve signup? (Defines Phase E.)
3. **Strict vs. lenient RLS when GUC unset:** allow-all (current design, safe for system tasks) vs. deny-all + a dedicated bypass role (stricter, more setup).

## 9. Recommended sequence

D (cutover) → C (RLS+GUC, behind a flag) → E (tenant admin, so isolation is testable with a real 2nd org) → verify isolation end-to-end → F/G polish. Phases A & B are already in and de-risk the rest.
