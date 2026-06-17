# PCS Platform — Environments (Dev & Prod)

Two isolated environments. **They never share a database.**

| | **Production** | **Development** |
|---|---|---|
| Git branch | `main` | `dev` |
| Neon DB | `pcs-db` — host `ep-noisy-butterfly-an022nus` | `pcs-dev-db` — host `ep-red-hall-aqifonr3` |
| Backend URL | `https://pcsapi.fabrixr.com` | `https://backend-git-dev-akash-mule-devs-projects.vercel.app` |
| Frontend URL | `https://pcsweb.fabrixr.com` | `https://frontend-git-dev-akash-mule-devs-projects.vercel.app` |
| Vercel target | Production | Preview (auto-tracks the `dev` branch) |
| Access | public (custom domains) | public (Vercel auth wall disabled) |

The `*-git-dev-*.vercel.app` URLs are **stable** — Vercel re-points them to the latest `dev` deployment on every push.

## How it's wired

**Backend (Vercel project `backend`)**
- `backend/vercel.json` Ignored Build Step builds **only** for `VERCEL_ENV=production` **or** the `dev` branch; every other branch's preview is skipped (so no stray preview can boot against a DB). See [[project_backend_preview_db_guard]].
- **DB selection is code-based** in `database.module.ts`: when `VERCEL_ENV !== 'production'` (any preview / the dev branch) it uses `dev_DATABASE_URL` (the `pcs-dev-db` connection the Neon integration injected); production uses `DATABASE_URL` (`pcs-db`). This is deterministic — a Vercel *branch-scoped* `DATABASE_URL` override was tried first and did **not** win over the env-wide value, so we don't rely on env-var precedence. (`pcs-dev-db` is reachable via either Neon pooler host `ep-red-hall-…` or `ep-steep-cherry-…` — same database.)
- `backend/src/database/database.module.ts` logs the redacted DB host on boot; `GET /api/health` also returns `{ environment, database.host }` — use it to confirm which DB a deployment is on.

**Frontend (Vercel project `frontend`)**
- `frontend/vercel.json` build command picks the Angular config by branch: `dev` branch → `--configuration dev` (→ `src/environments/environment.dev.ts`, points at the dev backend); everything else → `--configuration production` (→ prod API).

**CORS** — `backend/src/main.ts`: production uses the explicit `CORS_ORIGIN` list; non-production reflects any origin so dev/preview URLs work without per-URL config.

## Running locally

- **Backend:** reads `backend/.env`. It currently points `DATABASE_URL` at **pcs-dev-db** (the prod URL is backed up at `backend/.vercel/.env.prod.bak`). Run: `cd backend && node node_modules/@nestjs/cli/bin/nest.js start --watch` → http://localhost:3000.
- **Frontend:** `cd frontend && node node_modules/@angular/cli/bin/ng.js serve` → calls `http://localhost:3000/api` (your local backend → dev DB). Full-stack local dev runs entirely on the dev DB.
- To point local at prod (rare/careful): restore `backend/.env` from `backend/.vercel/.env.prod.bak`.

## Deploy flow

- Push to **`dev`** → dev backend + frontend previews rebuild against `pcs-dev-db`. Test there.
- Merge `dev` → **`main`** (or push `main`) → production rebuilds against `pcs-db`.

## Cautions

- **`synchronize: true`** is on in every environment (no `DB_SYNCHRONIZE` set), so the backend auto-mutates whatever DB it boots against. This is why the build guard + branch-scoped `DATABASE_URL` matter. Long term: add `DB_SYNCHRONIZE=false` + run migrations.
- Adding a backend preview for **any other branch** requires first giving it a non-prod `DATABASE_URL`; don't relax the guard without that.
- `backend/package-lock.json` must stay in sync with `package.json` or Vercel's `npm ci` fails.
- The `pcs-dev-db` password was shared in chat — consider rotating it in Neon.
