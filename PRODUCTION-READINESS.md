# PCS Platform — Production Readiness Audit & Fixes

**Date:** 2026-05-31
**Scope:** Backend (NestJS), Frontend (Angular 17), Mobile (React Native / Expo 52)
**Context:** Internal/demo — prioritizing functional completeness and correctness.

---

## Summary

The platform is substantially complete: all major backend modules, web feature
modules, and mobile screens are implemented and wired to the API. This effort
audited all three tiers and fixed every actionable issue found. Backend and
mobile both type-check clean (`tsc --noEmit` → 0 errors); the edited frontend
component passes a structural transpile check.

---

## Fixes applied (verified)

### Backend — `backend/`
1. **Auth-breaking JWT secret mismatch (CRITICAL).** Signing and verification used
   different hardcoded fallbacks, so with `JWT_SECRET` unset every token failed
   verification — auth silently broke. Centralized in
   `src/common/constants/jwt.constant.ts` (single source of truth; still throws in
   production if `JWT_SECRET` is missing).
2. **Destructive public seed endpoint (CRITICAL).** `POST /api/health/seed` wiped and
   recreated all users/roles with no auth. Now blocked in production, gated behind
   `ALLOW_SEED_ENDPOINT=true`, and no longer leaks a stack trace.
3. **Unsafe schema auto-sync (HIGH).** TypeORM `synchronize` was hardcoded `true`. Now
   defaults ON for non-production, OFF for production, overridable via
   `DB_SYNCHRONIZE`; production can never enable it implicitly.
4. **Weak seed password (HIGH).** All seeded users shared `123456`. Now driven by
   `SEED_DEFAULT_PASSWORD` with a loud warning when unset.
5. **ZIP path traversal / Zip Slip (MEDIUM).** `coordination` ZIP extraction now
   streams entries individually and rejects any entry that resolves outside the
   extraction directory.
6. **Permissive CORS (MEDIUM).** API no longer reflects arbitrary origins in non-prod;
   it uses the explicit allowlist (`CORS_ORIGIN`, default localhost). WebSocket CORS
   is now env-configurable too (was hardcoded).
7. **Inconsistent quality-data deletes (MEDIUM).** `removeByModel` hard-deleted while
   `remove` soft-deleted, and reads ignored `is_active` (so soft-delete never hid
   anything). Both now soft-delete and all reads honor `is_active`.
8. **Migration infrastructure.** Production now applies committed migrations on boot
   (`migrationsRun` enabled in prod, `synchronize` off). Added
   `src/database/migrations/` with a README documenting the generate/run workflow.

### Frontend — `frontend/`
9. **Silent 404s.** Added a real `NotFoundComponent` and `/404` route; the wildcard
   now routes there instead of silently redirecting home.
10. **Debug logging removed** from `coordination-view.component.ts`.
11. **Unhandled subscriptions.** `time-tracking-live` (including a 10s poll) had bare
    subscribes that could emit unhandled errors. Added explicit error handlers. Note:
    a global `errorInterceptor` already surfaces 4xx/5xx as snackbars, and stateful
    components already reset their loading flags on error — so error handling across
    the app is in good shape overall.

### Mobile — `mobile/`
12. **No crash protection.** Added an `ErrorBoundary` wrapping the app with a
    recoverable fallback UI.
13. **Hardcoded dev URL.** AR-viewer URL moved from inline to `config/environment.ts`.
14. **Two pre-existing type errors fixed:** `badgeId` added to the `User` type; WebView
    `onPermissionRequest` typing corrected.
15. **Offline indicator.** Added a global `OfflineBanner` (built on the existing
    connectivity service) showing offline status and queued-action count.
16. **Silent failures** in dashboard/profile/model-list/work-order screens now log in
    development instead of vanishing.

### Config / hygiene
17. `.env.example` documents all new flags (`DB_SYNCHRONIZE`, `JWT_EXPIRES_IN`,
    `SEED_DEFAULT_PASSWORD`, `ALLOW_SEED_ENDPOINT`).
18. Confirmed `.env` and `.env.production.local` are gitignored and were **never
    committed** (not in HEAD or history).

---

## Remaining manual items (cannot be done from here)

- **Rotate the live credentials** in `backend/.env` and `.env.production.local` (real
  AWS keys + Neon DB password). They are not in git, but the values are real — rotate
  them and move to a secrets manager.
- **Generate the baseline migration** against a real/empty Postgres using the
  documented `npm run migration:generate` workflow (no DB/Docker was available in this
  environment to generate and verify it).
- **Run full builds in CI:** `ng build` (frontend) and an EAS build (mobile). A full
  Angular template compile exceeded this environment's time limits.

---

## ACTION REQUIRED — git index is corrupt

The repository's git index is corrupt (`fatal: index file corrupt`,
`bad signature 0x00000000`) with a stale, undeletable `.git/index.lock`. This could
not be repaired from the assistant environment (the mounted filesystem denies deleting
files under `.git`). **No commits, history, or working files were lost** — only the
fully rebuildable index.

Fix on your machine (PowerShell/cmd, from the repo root):

```
del .git\index.lock
del .git\index
git reset
```

Then `git status` works again and shows all the edits above as modified.
