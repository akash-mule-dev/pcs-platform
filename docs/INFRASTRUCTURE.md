# FabriXR / PCS Platform — Infrastructure Reference

> Complete reference of all Vercel resources, DNS configuration, and deployment details.

---

## Table of Contents
1. [Hosting Overview](#hosting-overview)
2. [Vercel Projects](#vercel-projects)
3. [Backend Serverless Function](#backend-serverless-function)
4. [Custom Domains](#custom-domains)
5. [SSL & CDN](#ssl--cdn)
6. [Environment Variables (Secrets)](#environment-variables-secrets)
7. [Deployment & CI/CD](#deployment--cicd)
8. [Vercel Blob Storage](#vercel-blob-storage)
9. [Neon Database](#neon-database)
10. [DNS Configuration](#dns-configuration)
11. [Environment URLs](#environment-urls)
12. [Login Credentials](#login-credentials)

---

## Hosting Overview

The entire platform runs on **Vercel**. There are no servers to manage, no SSH, and no
process manager — Vercel builds and hosts both apps directly from the Git repository and
auto-deploys on every push.

| Component | How it runs on Vercel |
|-----------|-----------------------|
| Frontend (Angular) | Static build served from Vercel's edge CDN |
| Backend (NestJS) | Serverless function via `@codegenie/serverless-express` |
| SSL / HTTPS | Automatic, managed by Vercel |
| CDN / caching | Automatic, Vercel edge network |
| Secrets / config | Vercel project Environment Variables |
| Deploys | Git-integration auto-deploy + GitHub Actions (Vercel CLI) |

Config files live in the repo:

| File | Purpose |
|------|---------|
| `frontend/vercel.json` | Frontend build/output + SPA rewrite config |
| `backend/vercel.json` | Backend serverless function routing |

> Brand: **FabriXR**, primary domain `fabrixr.com` (the legacy `primeterminaltech.com`
> domain may still appear in some records).

---

## Vercel Projects

Two Vercel projects back the platform, each linked to this Git repository.

| Project | App | Framework | Config |
|---------|-----|-----------|--------|
| `frontend` | Angular SPA | Angular 17 (standalone) | `frontend/vercel.json` |
| `backend` | NestJS API | NestJS 11 (serverless) | `backend/vercel.json` |

### Git Integration & Branch Behavior
- Every push triggers a Vercel build automatically.
- Pushes to **`dev`** build the **dev** configuration and produce a preview deployment.
- The **backend selects its production configuration when `VERCEL_ENV=production`** (i.e.
  production deployments), otherwise it uses dev/preview settings.
- Each branch/PR gets its own preview URL; production deployments are promoted from the
  production branch.

### Stable Preview URLs (dev branch)
| Project | Preview URL |
|---------|-------------|
| `frontend` | https://frontend-git-dev-akash-mule-devs-projects.vercel.app |
| `backend` | https://backend-git-dev-akash-mule-devs-projects.vercel.app |

---

## Backend Serverless Function

The NestJS backend is wrapped with **`@codegenie/serverless-express`** and deployed as a
single Vercel serverless function rather than a long-running Node process.

| Aspect | Detail |
|--------|--------|
| Adapter | `@codegenie/serverless-express` (Express → Lambda-style handler) |
| Routing | Defined in `backend/vercel.json` |
| Environment switch | Production config active when `VERCEL_ENV=production` |
| Request body cap | **~4.5 MB** (Vercel serverless request limit) |

### Implication of the request body cap
Server-proxied uploads (IFC/ZIP import sources, GLB models, drawings, QA evidence) are
limited to ~4.5 MB per request. For packages above that size, the **client uploads
directly to Vercel Blob** and hands the backend the resulting storage key, bypassing the
serverless body limit.

### Conversion / background work
With no `REDIS_URL` set, the BullMQ conversion queue runs **inline** in the API process.
There is no separate worker host — the serverless function does the work in-request, and
interrupted imports are re-queued on cold start from their durable storage source.

---

## Custom Domains

Custom domains are attached to the Vercel projects; Vercel provisions and renews SSL
certificates automatically for each.

| Domain | Points to | Environment |
|--------|-----------|-------------|
| `www.fabrixr.com` | Landing page | Production |
| `app.fabrixr.com` | `frontend` project | Production frontend |
| `api.fabrixr.com` | `backend` project | Production backend |
| `pcsapi.fabrixr.com` | `backend` project | Production backend (alias) |
| `demo.fabrixr.com` | `frontend` project | Staging frontend |
| `demo-api.fabrixr.com` | `backend` project | Staging backend |

To add a domain: assign it to the project in **Vercel → Project → Settings → Domains**,
then add the DNS record Vercel shows (see [DNS Configuration](#dns-configuration)).

---

## SSL & CDN

SSL and CDN are **fully managed by Vercel** — there is nothing to provision or renew.

| Concern | How it's handled |
|---------|------------------|
| HTTPS / TLS certificates | Auto-issued and auto-renewed per custom domain by Vercel |
| HTTP → HTTPS redirect | Automatic |
| CDN / edge caching | Vercel's global edge network (frontend static assets) |
| SPA routing (Angular) | Rewrite rule in `frontend/vercel.json` (all paths → `index.html`) |
| Cache invalidation | Automatic on each new deployment (no manual invalidation step) |

> There are no SSL certificates, CDN distributions, or cache-invalidation commands to
> manage by hand — a new deployment publishes fresh assets globally.

---

## Environment Variables (Secrets)

All sensitive configuration is stored as **Vercel project Environment Variables**.
**Never in the codebase.**

Each project has three scopes — **Production**, **Preview**, and **Development** — so the
same key can resolve to different values per environment (e.g. dev vs prod database URLs).

### Key variables (per project, as applicable)
| Variable | Used by | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | backend | Neon connection string (scoped per environment) |
| `JWT_SECRET` | backend | JWT signing key |
| `STORAGE_TYPE` | backend | Storage provider (`vercel-blob` default) |
| `PCS_DEV_BLOB_READ_WRITE_TOKEN` / `BLOB_READ_WRITE_TOKEN` | backend | Vercel Blob token |
| `VERCEL_ENV` | both (Vercel-provided) | `production` / `preview` / `development` |
| `IMPORT_PIPELINE_CONCURRENCY` | backend | Import pipeline concurrency (optional) |
| `REDIS_URL` | backend | Enables external BullMQ worker (optional; inline if unset) |

### Managing variables
- **Vercel Dashboard:** Project → Settings → Environment Variables (add/edit per scope).
- **Vercel CLI:**
  ```bash
  vercel env ls                        # list variables
  vercel env add DATABASE_URL production   # add/update for a scope
  vercel env rm DATABASE_URL production     # remove
  ```
- Variables take effect on the **next deployment**; redeploy after changing a value.

---

## Deployment & CI/CD

There are two paths to a deployment, and both end up on Vercel.

### 1. Git-integration auto-deploy (default)
Pushing to the repo triggers Vercel to build and deploy automatically:
- Push to **`dev`** → preview deployment with the **dev** config.
- Push to the production branch → production deployment (backend uses prod config because
  `VERCEL_ENV=production`).
- Every branch/PR gets its own preview URL.

### 2. GitHub Actions (Vercel CLI)
`.github/workflows/deploy.yml` deploys through the **Vercel CLI**.

| GitHub Secret | Purpose |
|---------------|---------|
| `VERCEL_TOKEN` | Auth token for the Vercel CLI |
| `VERCEL_ORG_ID` | Target Vercel organization/team ID |
| `VERCEL_PROJECT_ID` | Target Vercel project ID |

Typical CLI flow used by the workflow:
```bash
vercel pull --yes --environment=production --token=$VERCEL_TOKEN
vercel build --prod --token=$VERCEL_TOKEN
vercel deploy --prebuilt --prod --token=$VERCEL_TOKEN
```

> Use the placeholders above — real token/ID values live only in GitHub Actions secrets
> and the Vercel dashboard, never in the repo.

---

## Vercel Blob Storage

Uploaded artifacts (IFC/ZIP import sources, GLB models, shop drawings, thumbnails, QA
evidence, coordination files) are stored in **Vercel Blob**, not in Postgres and not on
local disk. Neon only stores the `storage_key` / `file_name` pointer.

| Field | Value |
|-------|-------|
| Provider | Vercel Blob (`STORAGE_TYPE=vercel-blob`, default) |
| Alternate provider | Azure Blob (`STORAGE_TYPE=azure`) |
| Token | `PCS_DEV_BLOB_READ_WRITE_TOKEN` (or `BLOB_READ_WRITE_TOKEN`) |
| Visibility | **Private** — files are streamed back through the API, never a public URL |
| Key layout | Tenant-partitioned, centralized in `storage/storage-keys.ts` |

### Key layout
Every blob lives under its organization:
```
<orgId>/{imports,documents,models,conversions,quality/{evidence,ncr},coordination,media}/…
```
- GLBs: `<org>/models/<id>.glb`
- Thumbnails: `<org>/models/<id>/thumbnail.png`

### Notes
- Bytes already in memory go straight to the store via `storage.uploadBuffer(...)` — they
  never touch local disk.
- Because the store is private, downloads are proxied through the API (e.g.
  `GET /api/models/:id/file`) using the server-side token.
- Round-trip check: `node scripts/verify-blob.cjs` (needs the token in env).

---

## Neon Database

| Field | Value |
|-------|-------|
| Provider | Neon (https://console.neon.tech) |
| Engine | PostgreSQL |
| Region | US East |
| Endpoint | `ep-curly-pine-aivn3f9s-pooler.c-4.us-east-1.aws.neon.tech` |
| Database | `neondb` (shared by all 3 environments currently) |
| User | `neondb_owner` |
| Connection Pooling | Yes (`-pooler` endpoint) |
| SSL | Required |

### Connection String Format
```
postgresql://neondb_owner:<password>@ep-curly-pine-aivn3f9s-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require
```

### Database Branches
| Branch / Database | Purpose | Status |
|-------------------|---------|--------|
| `neondb` | Production (and currently shared with dev/stage) | Active ✅ |
| `pcs-dev-db` | Dedicated dev branch (isolated from prod) | Active ✅ |
| `pcs_stage` | Future dedicated stage database | Created, unused |

> The backend uses the dev branch (`pcs-dev-db`) by default; the production connection
> string is selected only when `VERCEL_ENV=production`.

### Viewing Data
1. Go to https://console.neon.tech
2. Select your project
3. Click **Tables** → Browse all tables visually

### Seed Data Included
- 9 users (admin, manager, supervisors, operators)
- 3 processes with 21 stages
- 3 production lines with 15 stations
- 5+ work orders
- 50+ time tracking entries

---

## DNS Configuration

**Domain:** `fabrixr.com`

All custom domains are served by Vercel. For each domain, add the DNS record Vercel shows
in **Project → Settings → Domains** — typically a `CNAME` to `cname.vercel-dns.com` for
subdomains, or Vercel's apex/ALIAS target for the root domain.

### DNS Records (pattern)

| Type | Name | Value | Purpose |
|------|------|-------|---------|
| **CNAME** | `app` | `cname.vercel-dns.com` | Prod frontend (`app.fabrixr.com`) |
| **CNAME** | `api` | `cname.vercel-dns.com` | Prod backend (`api.fabrixr.com`) |
| **CNAME** | `pcsapi` | `cname.vercel-dns.com` | Prod backend alias (`pcsapi.fabrixr.com`) |
| **CNAME** | `demo` | `cname.vercel-dns.com` | Staging frontend (`demo.fabrixr.com`) |
| **CNAME** | `demo-api` | `cname.vercel-dns.com` | Staging backend (`demo-api.fabrixr.com`) |
| **CNAME** | `www` | `cname.vercel-dns.com` | Landing page (`www.fabrixr.com`) |
| **A / ALIAS** | `@` (root) | Vercel apex target | Root domain (per Vercel dashboard) |

> The exact record values are shown by Vercel when you attach each domain; SSL validation
> and renewal are handled automatically once the record resolves.

### How DNS Routes Traffic
```
User → app.fabrixr.com
       │
       ▼ (CNAME)
       cname.vercel-dns.com (Vercel edge)
       │
       ▼
       frontend project (Angular SPA)


User → api.fabrixr.com
       │
       ▼ (CNAME)
       cname.vercel-dns.com (Vercel edge)
       │
       ▼
       backend project (NestJS serverless function)
```

---

## Environment URLs

### Production
| Service | URL |
|---------|-----|
| Landing Page | https://www.fabrixr.com |
| FabriXR App | https://app.fabrixr.com |
| Backend API | https://api.fabrixr.com |
| Backend API (alias) | https://pcsapi.fabrixr.com |
| Swagger Docs | https://api.fabrixr.com/api/docs |

### Staging
| Service | URL |
|---------|-----|
| Frontend | https://demo.fabrixr.com |
| Backend API | https://demo-api.fabrixr.com |
| Swagger Docs | https://demo-api.fabrixr.com/api/docs |

### Development (dev branch previews)
| Service | URL |
|---------|-----|
| Frontend | https://frontend-git-dev-akash-mule-devs-projects.vercel.app |
| Backend API | https://backend-git-dev-akash-mule-devs-projects.vercel.app |
| Swagger Docs | https://backend-git-dev-akash-mule-devs-projects.vercel.app/api/docs |

---

## Login Credentials

All environments share the same seed data:

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@pcs.local` | `password123` |
| Manager | `manager@pcs.local` | `password123` |
| Supervisor | `supervisor1@pcs.local` | `password123` |
| Operator 1 | `operator1@pcs.local` | `password123` |
| Operator 2 | `operator2@pcs.local` | `password123` |
| Operator 3 | `operator3@pcs.local` | `password123` |
| Operator 4 | `operator4@pcs.local` | `password123` |
| Operator 5 | `operator5@pcs.local` | `password123` |

---

*Document created: February 22, 2026*
*Last updated: June 2026 — reference now describes the Vercel deployment*
