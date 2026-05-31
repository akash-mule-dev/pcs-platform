# PCS Platform — Pre-Delivery Checklist

Status as of 2026-05-31. Grouped by priority. Items marked **[code done]** are
already fixed in the codebase and only need deploying; the rest require action.

---

## 0. Ship the fixes already made (do first)

The git index is corrupt and a stale lock is present. On your machine, repo root,
**close the Claude desktop app / any git process first**, then:

```
del .git\HEAD.lock
del .git\index.lock
del .git\index
git reset
```

Then commit the one uncommitted fix and push everything:

```
git add backend/src/dashboard/dashboard.service.ts
git commit -m "Bound efficiency metrics at 100% (fix inflated KPI values)"
git push origin main
```

- [ ] Repair git (commands above)
- [ ] Push — sends `989c5a8` (dashboard + time-tracking 500 fixes) and the efficiency commit
- [ ] Confirm Render redeploys the backend (auto on push, or trigger manually)
- [ ] Re-test in Chrome: Dashboard KPIs populate, Time Tracking loads, Reports efficiency tops out at 100%

---

## 1. Functional bugs (all code-fixed; verify after deploy)

- [x] **[code done]** `GET /api/dashboard/summary` 500 → resilient per-KPI computation
- [x] **[code done]** `GET /api/time-tracking/active` 500 → graceful degradation
- [x] **[code done]** Inflated efficiency (45,000%) → capped at 100% everywhere
- [ ] Verify each of the above against the live app after redeploy

---

## 2. Security (blockers for customer delivery)

- [ ] **Rotate the live credentials** in `backend/.env` and `.env.production.local`
      (AWS access keys + Neon DB password). They are gitignored but real — revoke,
      reissue, and store in a secrets manager (Render env vars / AWS Secrets Manager).
- [ ] Set a strong **`JWT_SECRET`** in every deployed environment (app refuses to
      boot in production without it — good).
- [ ] Remove default seeded passwords; set **`SEED_DEFAULT_PASSWORD`** (or seed real
      accounts) so no account uses `123456`.
- [ ] Confirm **`ALLOW_SEED_ENDPOINT`** is unset/false in production (the destructive
      seed endpoint is blocked in prod by default — verify).
- [ ] Set **`CORS_ORIGIN`** to the real frontend origin(s) in prod.

---

## 3. Production data

- [ ] Clean the production database of test data ("Test Product …", "Test Process …",
      "Security Check" / "Test User" accounts, auto-generated work orders).
- [ ] Seed real reference data (products, processes, stages, lines, stations) or
      import the customer's.
- [ ] Create the real admin/operator accounts with proper credentials.

---

## 4. Database migrations

- [ ] Generate the baseline migration against a real Postgres (tooling + steps are in
      `backend/src/database/migrations/README.md`).
- [ ] Commit migrations; confirm prod runs with `synchronize` OFF and applies
      migrations on boot (`migrationsRun` is enabled in production).
- [ ] Never set `DB_SYNCHRONIZE=true` in production.

---

## 5. Build, test & CI (verify nothing here was run from the assistant env)

- [ ] `cd backend && npm ci && npm run build` succeeds.
- [ ] `cd frontend && npm ci && npm run build -- --configuration production` succeeds.
- [ ] Backend tests: `npm test` (and the API/e2e suites in `tests/`).
- [ ] Mobile build: `eas build` (Expo) for the target platform(s).
- [ ] Add a CI gate so builds + tests must pass before deploy.

---

## 6. Mobile app (not runtime-tested from here)

- [ ] Smoke-test the React Native app against the prod API: login, clock in/out,
      work orders, 3D/AR viewer, offline banner, error boundary.
- [ ] Verify the AR-viewer URL is correct per environment (`mobile/src/config/environment.ts`).
- [ ] Confirm token storage / auth behaves on a real device.

---

## 7. Ops & polish (recommended, not blockers)

- [ ] Confirm health checks (`/api/health`, `/api/health/ready`) are wired to the host.
- [ ] Set up error monitoring/log aggregation (the global exception filter now logs
      cause + route — point it at a log drain or Sentry).
- [ ] Review rate-limiting thresholds (`THROTTLE_TTL`, `THROTTLE_LIMIT`).
- [ ] Decide whether the 404 page should render inside the app shell (currently
      standalone) — cosmetic.

---

## Bottom line

Functionality is complete and the known code bugs are fixed. Remaining work to be
truly customer-ready is the "last mile": deploy & verify (section 0–1), security
(2), clean data (3), migrations (4), and full build/test + mobile verification
(5–6). Realistically ~1–2 focused days.
