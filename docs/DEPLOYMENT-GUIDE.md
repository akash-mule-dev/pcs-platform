# FabriXR Platform — Deployment Guide

> Step-by-step instructions for deploying code changes to all 3 environments.

Both the Angular frontend and the NestJS backend run on **Vercel**. Vercel's Git
integration auto-builds and deploys on every push, so the normal deploy is simply
`git push` to the relevant branch. Manual / CI deploys use the **Vercel CLI** (the
repo's `.github/workflows/deploy.yml` already wraps this).

---

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [How Deploys Work (Git Integration)](#how-deploys-work-git-integration)
3. [Backend Deployment](#backend-deployment)
4. [Frontend Deployment](#frontend-deployment)
5. [Mobile App Build](#mobile-app-build)
6. [Database Operations](#database-operations)
7. [Rollback Procedures](#rollback-procedures)
8. [Monitoring & Logs](#monitoring--logs)

---

## Prerequisites

### Local Machine Requirements
```bash
# Node.js and Angular CLI
node -v    # v20+
ng version # Angular 17+

# Vercel CLI (only needed for manual / CI deploys — Git push deploys without it)
npm i -g vercel
vercel whoami   # Should show your authenticated Vercel user
```

### Vercel Access
- A Vercel account that is a member of the FabriXR team/org.
- Two Vercel projects: **frontend** (Angular) and **backend** (NestJS serverless).
- For non-interactive (CI / scripted) deploys you need a **Vercel token** plus the
  project/org identifiers, supplied as environment variables:
  ```bash
  export VERCEL_TOKEN=<VERCEL_TOKEN>
  export VERCEL_ORG_ID=<VERCEL_ORG_ID>
  export VERCEL_PROJECT_ID=<VERCEL_PROJECT_ID>
  ```
  In CI these come from the repo secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`,
  `VERCEL_PROJECT_ID` (see `.github/workflows/deploy.yml`).

### Environments at a glance
| Env | Branch / trigger | Frontend URL | Backend URL |
|-----|------------------|--------------|-------------|
| **DEV** | push to `dev` (or `dev` Git branch on Vercel) | https://frontend-git-dev-akash-mule-devs-projects.vercel.app | https://backend-git-dev-akash-mule-devs-projects.vercel.app |
| **STAGE / DEMO** | manual / CI | https://demo.fabrixr.com | https://demo-api.fabrixr.com |
| **PROD** | production deploy | https://app.fabrixr.com / https://www.fabrixr.com | https://api.fabrixr.com (alias https://pcsapi.fabrixr.com) |

SSL and the CDN are provisioned automatically by Vercel for every domain above.

---

## How Deploys Work (Git Integration)

Vercel watches the repo and builds on every push — no manual upload step.

- **`dev` branch → DEV preview.** The frontend `vercel.json` `buildCommand` checks
  `VERCEL_GIT_COMMIT_REF`: on `dev` it builds `--configuration dev`, otherwise
  `--configuration production`. The backend `vercel.json` `ignoreCommand` lets the
  build proceed when `VERCEL_GIT_COMMIT_REF` is `dev` (or `VERCEL_ENV` is
  `production`) and skips it otherwise — so the `dev` branch produces the dev backend.
- **Production deploy → PROD.** A production deploy (promoting a build to the
  production domain) builds with the production config. The backend selects its
  production settings when **`VERCEL_ENV=production`**.

So the everyday workflow is just:

```bash
git push origin dev          # builds & deploys the DEV preview automatically
# ...and a production deploy (CLI/CI/Promote in the dashboard) ships PROD
```

The sections below cover the explicit per-environment commands (used by CI and for
manual deploys) and verification.

---

## Backend Deployment

The backend is deployed as a **Vercel serverless function**
(`@codegenie/serverless-express`) — config in `backend/vercel.json`. Build & install
are driven by Vercel (`installCommand: npm ci --include=dev`,
`buildCommand: npm run vercel-build`); all `/(.*)` requests are rewritten to `/api`.

> **Serverless body cap:** a Vercel serverless request body is limited to ~4.5 MB, so
> large uploads (IFC/ZIP import sources, GLB models) go straight to **Vercel Blob**
> from the client rather than through the API. Keep that in mind when testing upload paths.

### Step 1 (default): Deploy by pushing
```bash
# DEV — push the dev branch; Vercel builds the dev backend automatically
git push origin dev
```
That's the entire dev backend deploy. For STAGE / PROD use the CLI/CI flow below.

### Step 2 (manual / CI): Deploy with the Vercel CLI
Run from the `backend/` directory (or point the CLI at it). Ensure `VERCEL_TOKEN`,
`VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` are set (see Prerequisites).

#### Deploy to DEV
```bash
cd backend
vercel pull --yes --environment=preview --token="$VERCEL_TOKEN"
vercel build --token="$VERCEL_TOKEN"
vercel deploy --prebuilt --token="$VERCEL_TOKEN"
echo "✅ Dev backend deployed"
```

#### Deploy to STAGE
```bash
cd backend
vercel pull --yes --environment=preview --token="$VERCEL_TOKEN"
vercel build --token="$VERCEL_TOKEN"
vercel deploy --prebuilt --token="$VERCEL_TOKEN"
# Alias the resulting deployment to the demo API domain if not auto-aliased:
# vercel alias set <deployment-url> demo-api.fabrixr.com --token="$VERCEL_TOKEN"
echo "✅ Stage backend deployed"
```

#### Deploy to PROD
```bash
cd backend
vercel pull --yes --environment=production --token="$VERCEL_TOKEN"
vercel build --prod --token="$VERCEL_TOKEN"        # VERCEL_ENV=production → prod config
vercel deploy --prebuilt --prod --token="$VERCEL_TOKEN"
echo "✅ Prod backend deployed"
```

> CI does exactly this — see the `deploy-*` jobs in `.github/workflows/deploy.yml`.

### Step 3: Verify
```bash
# DEV
curl -s https://backend-git-dev-akash-mule-devs-projects.vercel.app/api/auth/login \
  -X POST -H "Content-Type: application/json" \
  -d '{"email":"admin@pcs.local","password":"password123"}'

# PROD
curl -s https://api.fabrixr.com/api/auth/login \
  -X POST -H "Content-Type: application/json" \
  -d '{"email":"admin@pcs.local","password":"password123"}'
```

> **Secrets / config** (e.g. `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN` /
> `PCS_DEV_BLOB_READ_WRITE_TOKEN`, JWT secret) are set per environment in the Vercel
> project's **Settings → Environment Variables** — never committed to the repo.

---

## Frontend Deployment

The frontend is a static Angular SPA hosted on Vercel — config in
`frontend/vercel.json`. Vercel runs the build (`node stamp-build.js` stamps the
commit hash + timestamp shown in the sidebar, then `ng build` with the env-specific
configuration), serves `dist/frontend/browser`, and the `rewrites` rule sends every
route to `/index.html` so deep links like `/dashboard` and `/projects` work
(SPA fallback — replaces the need for any separate error-document setup).

### Step 1 (default): Deploy by pushing
```bash
# DEV — push the dev branch; Vercel builds with --configuration dev automatically
git push origin dev
```
The `vercel.json` `buildCommand` selects the build configuration from the branch
(`dev` → dev config, otherwise production), so no local `ng build` is required.

### Step 2 (manual / CI): Deploy with the Vercel CLI
Run from the `frontend/` directory with `VERCEL_TOKEN` / `VERCEL_ORG_ID` /
`VERCEL_PROJECT_ID` set.

#### Deploy to DEV
```bash
cd frontend
vercel pull --yes --environment=preview --token="$VERCEL_TOKEN"
vercel build --token="$VERCEL_TOKEN"
vercel deploy --prebuilt --token="$VERCEL_TOKEN"
```

#### Deploy to STAGE
```bash
cd frontend
vercel pull --yes --environment=preview --token="$VERCEL_TOKEN"
vercel build --token="$VERCEL_TOKEN"
vercel deploy --prebuilt --token="$VERCEL_TOKEN"
# Alias to the demo domain if not auto-aliased:
# vercel alias set <deployment-url> demo.fabrixr.com --token="$VERCEL_TOKEN"
```

#### Deploy to PROD
```bash
cd frontend
vercel pull --yes --environment=production --token="$VERCEL_TOKEN"
vercel build --prod --token="$VERCEL_TOKEN"
vercel deploy --prebuilt --prod --token="$VERCEL_TOKEN"
```

> The CDN cache is managed by Vercel automatically — each new production deploy is
> served immediately on promotion, so there is no manual cache-invalidation step.

### Step 3: Verify
Open the URL in a browser:
- DEV: https://frontend-git-dev-akash-mule-devs-projects.vercel.app
- STAGE: https://demo.fabrixr.com
- PROD: https://app.fabrixr.com (and https://www.fabrixr.com)

> The frontend's API base URL per environment lives in Angular's `environment*.ts`
> files (dev points at the dev/demo backend; production at https://api.fabrixr.com).

---

## Mobile App Build

### Android (Debug APK)
```bash
cd mobile

# 1. Build web assets
npx ng build --configuration=production

# 2. Sync to Android
npx cap sync android

# 3. Build APK
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export ANDROID_HOME=$HOME/android-sdk
cd android && ./gradlew assembleDebug

# APK at: android/app/build/outputs/apk/debug/app-debug.apk
```

### Android (Release APK)
See `docs/MOBILE-BUILD-GUIDE.md` for signing instructions.

### iOS
Requires macOS + Xcode. See `docs/MOBILE-BUILD-GUIDE.md`.

---

## Database Operations

The database is **Neon PostgreSQL**. Each environment uses its own Neon branch via the
`DATABASE_URL` set in the relevant Vercel project's Environment Variables (the dev
branch is isolated from prod).

### Run Seed Data
Run the seed against the target environment's `DATABASE_URL`. Locally, point your
`.env`/`DATABASE_URL` at the desired Neon branch and run:
```bash
cd backend
node -e "
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module.js');
const { SeedService } = require('./dist/seed/seed.service.js');
(async()=>{
  const app = await NestFactory.createApplicationContext(AppModule);
  await app.get(SeedService).seed();
  await app.close();
  console.log('Seeded');
})();
"
```
> Make sure `DATABASE_URL` is exported (or in `backend/.env`) and points at the
> intended Neon branch before running — the seed writes to whatever DB it connects to.

### Connect to Database Directly
```bash
# From local machine (needs psql installed)
psql 'postgresql://neondb_owner:<password>@ep-curly-pine-aivn3f9s-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require'
```

### View Data in Browser
Go to https://console.neon.tech → Your Project → Tables

---

## Rollback Procedures

### Backend / Frontend Rollback (instant — Vercel)
Vercel keeps every prior deployment, so rolling back does **not** require a rebuild:
1. **Dashboard:** open the Vercel project → **Deployments**, find the last known-good
   deployment, and use the **⋯ → Promote to Production** (or **Rollback**) action.
2. **CLI:** re-promote a previous deployment URL:
   ```bash
   vercel ls --token="$VERCEL_TOKEN"                 # list recent deployments
   vercel promote <previous-deployment-url> --token="$VERCEL_TOKEN"
   ```
3. **Git:** alternatively revert the offending commit and push — the Git integration
   builds and ships the reverted state automatically:
   ```bash
   git log --oneline -5          # find the commit to revert
   git revert <commit-hash>
   git push origin <branch>      # dev → DEV; production deploy → PROD
   ```

### Database Rollback
Neon provides **point-in-time recovery**:
1. Go to Neon Console → Your Project → Branches
2. Create a new branch from a past timestamp
3. Update the `DATABASE_URL` (in the relevant Vercel project's Environment Variables)
   to point to the new branch, then redeploy.

---

## Monitoring & Logs

### Backend / Frontend Logs
Vercel captures build and runtime logs per deployment:
- **Dashboard:** Vercel project → **Deployments → [a deployment] → Logs** (build logs)
  and the **Logs / Runtime Logs** tab for live serverless-function invocations.
- **CLI:** stream runtime logs for a deployment:
  ```bash
  vercel logs <deployment-url> --token="$VERCEL_TOKEN"
  ```

### Health Checks
```bash
# Backend health (returns JSON when up)
curl -s https://api.fabrixr.com/api/health || echo "DOWN"

# Frontend reachable
curl -sI https://app.fabrixr.com | head -n 1
```

### Vercel Monitoring & Analytics
- **Deployments:** Vercel Console → Project → Deployments (status, build time, source commit).
- **Observability / Logs:** Project → **Observability** (and **Logs**) for function
  invocations, errors, and latency.
- **Analytics:** Project → **Analytics** for traffic and Web Vitals.
- **Domains / SSL:** Project → **Settings → Domains** (certificates are auto-managed).

---

## One-Command Deploy Scripts

### Deploy Everything to Prod
With Git integration the simplest production deploy is a push + production promote, but
here is an explicit CLI script (backend + frontend) for manual / scripted runs. It
expects `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` in the environment.

```bash
#!/bin/bash
set -e
echo "🚀 Deploying to PRODUCTION..."

# Backend (serverless function)
cd backend
vercel pull --yes --environment=production --token="$VERCEL_TOKEN"
vercel build --prod --token="$VERCEL_TOKEN"
vercel deploy --prebuilt --prod --token="$VERCEL_TOKEN"
cd ..

# Frontend (Angular SPA)
cd frontend
vercel pull --yes --environment=production --token="$VERCEL_TOKEN"
vercel build --prod --token="$VERCEL_TOKEN"
vercel deploy --prebuilt --prod --token="$VERCEL_TOKEN"
cd ..

echo "✅ Production deployment complete!"
```

Save this as `scripts/deploy-prod.sh` and run with `bash scripts/deploy-prod.sh`.

> Each Vercel project has its own org/project IDs — set `VERCEL_PROJECT_ID`
> appropriately per project (or run `vercel pull` from each linked directory, which
> writes the right `.vercel/project.json`).

---

*Document created: February 22, 2026*
