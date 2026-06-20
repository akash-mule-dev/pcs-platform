# FabriXR Platform — Vercel Deployment Guide
### A Complete Walkthrough for Beginners

> This document explains everything we set up on Vercel for the FabriXR Platform — what each piece does, why we need it, and how they all connect together. The short version: Vercel handles almost all the infrastructure for us, so there is far less to set up than a traditional server-based deployment.

---

## Table of Contents
1. [The Big Picture](#1-the-big-picture)
2. [What is Vercel?](#2-what-is-vercel) — [vercel.com](https://vercel.com/)
3. [The Two Vercel Projects](#3-the-two-vercel-projects)
4. [Git Integration — Auto-Deploy on Every Push](#4-git-integration--auto-deploy-on-every-push)
5. [Environment Variables — Secrets Management](#5-environment-variables--secrets-management)
6. [Custom Domains, SSL & CDN](#6-custom-domains-ssl--cdn)
7. [Vercel Blob — File Storage](#7-vercel-blob--file-storage)
8. [Neon DB — Your Database](#8-neon-db--your-database) — [neon.tech](https://neon.tech/)
9. [Dev / Staging / Prod — Why Multiple Environments?](#9-dev--staging--prod--why-multiple-environments)
10. [How Everything Connects](#10-how-everything-connects)
11. [How Code Gets Deployed](#11-how-code-gets-deployed)
12. [Security — What Protects What](#12-security--what-protects-what)
13. [Common Tasks & Commands](#13-common-tasks--commands)
14. [Cost Breakdown](#14-cost-breakdown)
15. [Glossary](#15-glossary)

---

## 1. The Big Picture

Before diving into each piece, here's what we built and why:

```
┌──────────────────────────────────────────────────────────────────┐
│                        THE INTERNET                              │
│                                                                  │
│   User opens browser                                             │
│        │                                                         │
│        ▼                                                         │
│   ┌─────────────┐         ┌──────────────────────┐               │
│   │  Frontend    │         │   Backend             │              │
│   │  Vercel proj │ ──API──▶│   Vercel project      │              │
│   │  (Angular)   │ calls   │   (NestJS serverless) │              │
│   │              │         │                      │              │
│   │  HTML/CSS/JS │         │  Serverless function  │              │
│   │  served on   │         │  + Vercel Blob for    │              │
│   │  Vercel CDN  │         │  file storage         │              │
│   └─────────────┘         └──────────┬───────────┘              │
│                                       │                          │
│                                       ▼                          │
│                            ┌──────────────────┐                  │
│                            │   Neon Database    │                 │
│                            │   (PostgreSQL)     │                 │
│                            │   Cloud-hosted     │                 │
│                            └──────────────────┘                  │
└──────────────────────────────────────────────────────────────────┘
```

**In simple terms:**
- Your **frontend** (Angular app) is a bunch of HTML/CSS/JS files that Vercel builds and serves from its global CDN.
- Your **backend** (NestJS API) runs as a **Vercel serverless function** — there is no server you log into or keep running; Vercel spins it up on demand for each request.
- Your **database** (PostgreSQL) lives on **Neon** (a cloud database provider, separate from your hosting).
- Your **uploaded files** (3D models, drawings, QA evidence, etc.) live in **Vercel Blob** object storage.
- When a user opens the website, their browser downloads the frontend from Vercel's CDN, and the frontend makes API calls to the backend serverless function, which reads/writes data to the Neon database and files to Vercel Blob.

---

## 2. What is Vercel?

**Vercel** is a cloud platform that builds, hosts, and serves web apps and APIs for you. You connect your Git repository, and Vercel takes care of building your code and putting it online — including the servers, the CDN, and the HTTPS certificates.

Think of it this way:
- **The traditional way:** You rent a virtual server, install an operating system, install Node.js, configure a firewall, set up a process manager to keep your app running, install a web server, request and renew SSL certificates, and deploy code by copying files over SSH.
- **The Vercel way:** You connect your GitHub repo. Every time you push code, Vercel automatically builds it and deploys it worldwide with HTTPS already configured. There is no server to log into, no firewall to manage, no certificates to renew.

**Why Vercel?**
- No servers to provision, patch, or keep alive — it is fully managed.
- Automatic builds and deploys straight from Git (push to deploy).
- A global CDN and automatic HTTPS are included with zero configuration.
- Per-branch preview deployments make it easy to test changes before they go live.
- You only pay for what you use, and a generous free/hobby tier covers small projects.

**Our setup at a glance:**
- Hosting platform: **Vercel**, for both the frontend and the backend.
- Config files: `frontend/vercel.json` and `backend/vercel.json` live in the repo and tell Vercel how to build each project.

---

## 3. The Two Vercel Projects

We run **two separate Vercel projects** from the one repository — one for the frontend, one for the backend. Each has its own build settings, its own URLs, and its own environment variables.

### Frontend project (Angular)
- Builds the Angular app into static HTML/CSS/JS and serves it from Vercel's CDN.
- Build configuration lives in `frontend/vercel.json`.
- Dev preview URL: `https://dev.fabrixr.com`

### Backend project (NestJS serverless)
- Runs the NestJS API as a **Vercel serverless function**. We use the `@codegenie/serverless-express` adapter so the existing NestJS/Express app can run inside a Vercel function without a long-running server.
- Build configuration lives in `backend/vercel.json`.
- Dev preview URL: `https://demo-api.fabrixr.com`

### Important caveat: the request body size limit
Because the backend runs as a serverless function, Vercel enforces a request body cap of **about 4.5 MB**. That is fine for normal API calls, but it is too small for large file uploads (3D models, big drawing packages, etc.).

> **How we handle it:** large uploads go **straight from the browser to Vercel Blob**, instead of being proxied through the API. The backend only handles the small metadata/pointer afterward. See [Vercel Blob](#7-vercel-blob--file-storage) below.

---

## 4. Git Integration — Auto-Deploy on Every Push

This is the heart of how Vercel works, and it replaces the entire "build locally, copy files to a server, restart the process" routine.

### How it works
Both Vercel projects are connected to the Git repository. When you push code, Vercel notices the new commit and automatically builds and deploys it:

```
Developer pushes code to GitHub
        │
        ▼
Vercel detects the new commit
        │
        ▼
Vercel automatically:
  1. Installs dependencies
  2. Builds the project (using vercel.json settings)
  3. Deploys it to a URL with HTTPS
        │
        ▼
App is live — no manual steps!
```

### Which branch deploys where
- Pushing to the **`dev`** branch builds using the **dev** configuration and updates the dev preview URLs.
- **Production** deploys use the **production** configuration. On the backend, production behavior is selected when the environment variable `VERCEL_ENV=production` (Vercel sets this automatically for production deployments), which is how the backend knows to use the production database/config.
- Every branch and pull request also gets its own throwaway **preview deployment**, so you can click a link and test a change in isolation before merging.

### No SSH, no restarts
There is no server to log into and no process to restart. A new deployment simply replaces the previous one. If a deployment is bad, you can instantly roll back to a previous deployment from the Vercel dashboard.

---

## 5. Environment Variables — Secrets Management

### The problem
Your app needs secrets: the database connection string, JWT signing keys, the storage token, and so on. You **never** put these in your code (someone could find them on GitHub). So where do you store them?

### The solution: Vercel Environment Variables
Each Vercel project has an **Environment Variables** section (Project → Settings → Environment Variables). This is Vercel's built-in secret store — you add a key and a value, and Vercel injects it into your build and into the running function as a normal environment variable. The values are encrypted at rest and are never exposed in your code.

You can scope each variable to one or more of three environments:
- **Production** — used by production deployments.
- **Preview** — used by branch/PR preview deployments (including `dev`).
- **Development** — used when running `vercel dev` locally.

### What we store there
| Variable | Used by | Contains |
|----------|---------|----------|
| `DATABASE_URL` | Backend | Neon PostgreSQL connection string |
| `JWT_SECRET` | Backend | JWT signing key |
| `STORAGE_TYPE` | Backend | Storage provider selector (set to `vercel-blob`, the default) |
| `PCS_DEV_BLOB_READ_WRITE_TOKEN` (or `BLOB_READ_WRITE_TOKEN`) | Backend | Token for reading/writing Vercel Blob |
| `VERCEL_ENV` | Backend (set by Vercel) | `production` on prod deploys; selects prod config |

> **Tip:** Use the per-environment scoping so the dev/preview deployments point at the **dev** Neon branch and the production deployment points at the production database — the same secret name, different value per environment.

---

## 6. Custom Domains, SSL & CDN

### Custom domains
Vercel gives every project a default `*.vercel.app` URL (like the dev preview URLs above), but we map friendly custom domains on top of those. You add the domain in the Vercel project's **Domains** settings and point your DNS at Vercel; Vercel handles the rest.

Our FabriXR domains:

| Domain | Points to | Environment |
|--------|-----------|-------------|
| `app.fabrixr.com` | Frontend project | Production |
| `api.fabrixr.com` | Backend project | Production |
| `pcsapi.fabrixr.com` | Backend project | Production (alias) |
| `demo.fabrixr.com` | Frontend project | Staging |
| `demo-api.fabrixr.com` | Backend project | Staging |
| `www.fabrixr.com` | Landing page | Production |

### SSL/TLS (HTTPS) — automatic
Vercel **automatically provisions and renews SSL certificates** for every domain (including the custom ones above). There are no certificates to request, install, or renew, and no manual configuration. The moment a domain is verified, it serves over HTTPS with the lock icon in the browser.

### CDN — automatic
Every Vercel deployment is served from Vercel's **global edge network (CDN)** out of the box. Your static frontend files are cached at locations around the world, so users load the app from a nearby edge location for speed. Again, there is nothing to set up — it is on by default.

> In short: the certificate management and content-delivery layers that used to require separate services are now handled automatically by Vercel.

---

## 7. Vercel Blob — File Storage

### The analogy
**Vercel Blob** is object storage — like a giant managed file folder in the cloud. You put **files** ("blobs") in it under a key (a path-like name) and read them back later. The platform uses it for every uploaded artifact: IFC/ZIP import sources, GLB 3D models, shop drawings, thumbnails, QA evidence, and coordination files.

### Why Blob (and not the database or a disk)?
- **Blobs never live in PostgreSQL.** The database only stores a small pointer — the `storage_key` / `file_name` — to where the blob lives. Databases are bad at storing big binary files.
- **Blobs never live on local disk.** Serverless functions are ephemeral; there is no persistent disk to keep files on. Object storage is durable and shared across every function invocation.

### Our configuration
- `STORAGE_TYPE=vercel-blob` — this is the default storage provider. (The only other supported provider is **Azure Blob**; there is no longer any other object-storage backend.)
- Access token: `PCS_DEV_BLOB_READ_WRITE_TOKEN` (or `BLOB_READ_WRITE_TOKEN`) — stored as a Vercel environment variable.
- The store is **private**. Files are not served from a public URL; instead they are **streamed back through the API** (the backend downloads from Blob using the server-side token and pipes the bytes to the client). This keeps uploaded files access-controlled.

### Key layout
Keys are tenant-partitioned, e.g. `<orgId>/models/<id>.glb`, `<orgId>/documents/...`, `<orgId>/quality/evidence/...`. We never hand-write key strings; they are produced centrally in code so the layout stays consistent.

### Large uploads bypass the API
As noted in [section 3](#3-the-two-vercel-projects), the serverless request body cap (~4.5 MB) means large files cannot be proxied through the backend. Instead, the browser uploads **directly to Vercel Blob** and then hands the backend the resulting key. Small artifacts that are already in memory can still go through the server.

---

## 8. Neon DB — Your Database

### What is Neon?
**Neon** is a cloud-hosted PostgreSQL database. Think of it as a PostgreSQL server that someone else manages for you — you just use it. Neon is independent of your hosting platform: we kept Neon exactly as-is when moving hosting to Vercel.

### Why a managed database (and not run PostgreSQL ourselves)?
- We'd otherwise have to manage backups, upgrades, and uptime ourselves.
- Serverless functions don't have a persistent place to run a database anyway.
- Neon has a nice **web console** to browse tables visually.
- Neon supports **database branches** — isolated copies of the data — which is perfect for keeping dev separate from prod.

### Our setup
```
Connection String: postgresql://neondb_owner:***@ep-curly-pine-aivn3f9s-pooler.c-4.us-east-1.aws.neon.tech/neondb
```

Let's break this down:
```
postgresql://          → Protocol (like http:// but for PostgreSQL)
neondb_owner           → Username
:***                   → Password
@ep-curly-pine-...     → Server hostname (Neon's own endpoint)
/neondb                → Database name
?sslmode=require       → Use encrypted connection
```

> Note: the hostname ends in `...aws.neon.tech`. That is simply Neon's own endpoint address — it is part of Neon's service, not something you configure or manage. Leave it exactly as Neon provides it.

### The "-pooler" part
Notice the hostname has `-pooler` in it. This means we're using **connection pooling**:
- Without pooling: each backend request opens a new database connection (slow, limited).
- With pooling: Neon maintains a pool of connections and shares them (fast, efficient).
- This is **essential for serverless**, where many short-lived function invocations each need a connection.

### Database branches (dev vs prod)
We use a Neon **branch named `pcs-dev-db`** for development, isolated from production data. The backend's `DATABASE_URL` env var (in Vercel) points dev/preview deployments at the dev branch and production deployments at the production database — same variable name, different value per environment.

### Viewing your data
1. Go to https://console.neon.tech
2. Select your project (and the right branch).
3. Click "Tables" in the sidebar.
4. Browse all your tables: users, projects, work_orders, shipments, etc.

---

## 9. Dev / Staging / Prod — Why Multiple Environments?

### The real-world problem
Imagine you're working on a new feature. You write code, deploy it directly to the live website, and... it has a bug. Now every user sees the broken page.

### The solution: multiple environments

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│   DEV    │ ──▶ │ STAGING  │ ──▶ │   PROD   │
│          │     │          │     │          │
│ For      │     │ For      │     │ For      │
│ building │     │ testing  │     │ real     │
│ features │     │ & demos  │     │ users    │
└──────────┘     └──────────┘     └──────────┘
   Messy,           Stable,          Rock
   breaking         tested           solid
   things OK        features         only
```

| Environment | Purpose | Who Uses It | Stability |
|------------|---------|-------------|-----------|
| **DEV** | Active development, trying new things | Developers only | Can break |
| **STAGING** | Testing before production, client demos | QA team, stakeholders | Should be stable |
| **PROD** | Live product, real users | Everyone | Must be rock solid |

### How they're separated on Vercel

**Hosting:** Each environment is just a different deployment of the same two Vercel projects, reached through different domains:
```
DEV     → frontend-git-dev-...vercel.app  /  backend-git-dev-...vercel.app
STAGING → demo.fabrixr.com                /  demo-api.fabrixr.com
PROD    → app.fabrixr.com                 /  api.fabrixr.com (+ pcsapi.fabrixr.com)
```

**Config selection:** The `dev` branch builds with the dev config; production deploys build with the production config (the backend keys off `VERCEL_ENV=production`).

**Database:** Dev/preview deployments use the Neon `pcs-dev-db` branch; production uses the production database. This is controlled by the `DATABASE_URL` environment variable, scoped per Vercel environment.

**Secrets:** Each environment has its own set of Vercel environment variables (Production / Preview / Development scopes), so dev secrets never touch production.

### The deployment flow
```
1. Developer writes code locally
2. Push to the dev branch → Vercel auto-deploys to the dev URLs
3. Test on the DEV environment
4. If good → promote/merge → staging deploy (demo.fabrixr.com)
5. QA/client tests on STAGING
6. If approved → deploy to PROD (app.fabrixr.com)
7. Real users see the update
```

---

## 10. How Everything Connects

### Request flow: user opens the app

```
Step 1: User types the prod URL in their browser
        https://app.fabrixr.com

Step 2: Browser requests the page from Vercel's CDN
        Vercel returns index.html + JavaScript + CSS files

Step 3: Browser loads the Angular app
        Angular app starts, shows the login page

Step 4: User enters email/password, clicks Login
        Angular sends a POST request to:
        https://api.fabrixr.com/api/auth/login
        with body: { email: "...", password: "..." }

Step 5: Vercel routes the request to the backend serverless function
        The function spins up (or reuses a warm instance)

Step 6: NestJS handles the /api/auth/login route
        AuthService validates credentials against Neon DB

Step 7: Backend queries Neon PostgreSQL (over the pooled connection)
        SELECT * FROM users WHERE email = '...'
        Validates the password hash
        Creates a JWT token

Step 8: Backend sends the response back
        { data: { accessToken: "eyJhb...", user: { ... } } }

Step 9: Angular receives the token, stores it
        Redirects to the dashboard
        All subsequent API calls include the token in headers:
        Authorization: Bearer eyJhb...

(For file uploads/downloads, the browser talks to Vercel Blob;
 large uploads go directly to Blob, downloads stream back through the API.)
```

### Network diagram
```
┌─────────────────────────────────────────────────────────────┐
│                     Internet                                 │
│                                                             │
│  ┌──────────┐                    ┌──────────────────────┐   │
│  │ Browser  │──── GET files ────▶│  Frontend (Vercel CDN)│  │
│  │          │◀── HTML/JS/CSS ────│  app.fabrixr.com      │   │
│  │          │                    └──────────────────────┘   │
│  │          │                                               │
│  │          │── API calls ──────▶┌──────────────────────┐   │
│  │          │◀── JSON ───────────│  Backend (Vercel fn)  │  │
│  │          │                    │  api.fabrixr.com      │   │
│  │          │── big uploads ──┐  └──────────┬───────────┘   │
│  └──────────┘                 │             │               │
│                               ▼             ▼               │
│                      ┌────────────────┐  ┌──────────────┐   │
│                      │  Vercel Blob    │  │ Neon Postgres│  │
│                      │  (file storage) │  │ (database)   │   │
│                      └────────────────┘  └──────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 11. How Code Gets Deployed

### The normal flow: git push → Vercel build
You almost never deploy by hand. You just push code, and Vercel's Git integration builds and deploys it:

```bash
# 1. Make your changes locally and commit
git add .
git commit -m "Add a new feature"

# 2. Push to the dev branch
git push origin dev

# 3. That's it. Vercel detects the push, builds both projects,
#    and updates the dev preview URLs automatically.
```

To ship to production, you promote/merge to the production branch (or promote the deployment in the Vercel dashboard); Vercel rebuilds with the production config.

### Building locally to verify first
Before pushing, it's good practice to make sure the code builds. (See `CLAUDE.md` for the exact CLI invocations used in this repo.)

```bash
# Backend type-check / build
cd backend && node node_modules/@nestjs/cli/bin/nest.js build

# Frontend build (includes Angular template type-checking)
cd frontend && node node_modules/@angular/cli/bin/ng.js build
```

### CI/CD via GitHub Actions
We also have an automated workflow at `.github/workflows/deploy.yml` that deploys using the **Vercel CLI**. It uses these repository secrets:

| Secret | Purpose |
|--------|---------|
| `VERCEL_TOKEN` | Authenticates the Vercel CLI |
| `VERCEL_ORG_ID` | Identifies the Vercel team/org |
| `VERCEL_PROJECT_ID` | Identifies the project to deploy |

> These are placeholders for whatever your team has configured — never commit the real values; they live in GitHub repo secrets.

### Manual deploy with the Vercel CLI (optional)
If you ever need to deploy outside of Git, you can use the CLI directly:
```bash
npm i -g vercel          # install the CLI
vercel login             # authenticate
vercel                   # deploy a preview
vercel --prod            # deploy to production
```

---

## 12. Security — What Protects What

### Layers of security

```
Layer 1: Platform (Vercel)
├── No servers to log into, patch, or expose by mistake
├── HTTPS/TLS enforced automatically on every domain
└── Deployments are immutable and instantly roll-back-able

Layer 2: Secrets
├── Database URL, JWT secret, and Blob token live in Vercel
│   Environment Variables (encrypted, scoped per environment)
└── Nothing sensitive is committed to the codebase

Layer 3: Storage
├── Vercel Blob store is private
├── Files are streamed through the API with a server-side token
└── No publicly guessable file URLs

Layer 4: Application
├── JWT tokens for API authentication
├── Role-based access (admin, manager, supervisor, operator)
├── Password hashing (bcrypt)
└── CORS restricts which frontends can call the API

Layer 5: Database
├── Encrypted (SSL) connection to Neon (sslmode=require)
├── Connection pooling guards connection limits
└── Dev data isolated on a separate Neon branch (pcs-dev-db)
```

### What could be improved
| Current | Better | Best |
|---------|--------|------|
| Shared prod/dev project settings | Separate Vercel teams per environment | Strict per-environment access controls |
| Single Blob token | Rotate Blob tokens regularly | Short-lived/scoped upload tokens |
| Manual secret entry | Sync secrets from a vault | Automated secret rotation |
| Broad CORS during setup | Lock CORS to known frontends | Per-environment CORS allowlists |

---

## 13. Common Tasks & Commands

### Deploy a change
```bash
# Just push — Vercel builds and deploys automatically:
git add .
git commit -m "your change"
git push origin dev          # dev/preview deploy
```

### Build locally to verify before pushing
```bash
cd backend && node node_modules/@nestjs/cli/bin/nest.js build
cd frontend && node node_modules/@angular/cli/bin/ng.js build
```

### View build logs / deployment status
1. Go to the Vercel dashboard (vercel.com).
2. Open the **frontend** or **backend** project.
3. Click the **Deployments** tab to see each build, its logs, and its URL.

### View runtime (function) logs
1. In the project, open the **Logs** (or **Observability**) tab.
2. You'll see live serverless-function invocations, errors, and timing.

### Roll back a bad deploy
1. In the project's **Deployments** list, find a previous good deployment.
2. Open its menu and choose **Promote to Production** (instant rollback).

### Update a secret / environment variable
1. Project → **Settings** → **Environment Variables**.
2. Edit the value and choose the environment scope (Production / Preview / Development).
3. **Redeploy** for the change to take effect (variables are injected at build/deploy time).

### Add or check a custom domain
1. Project → **Settings** → **Domains**.
2. Add the domain (e.g. `app.fabrixr.com`) and follow the DNS instructions.
3. Vercel verifies it and issues the SSL certificate automatically.

### Use the Vercel CLI (optional)
```bash
vercel ls                # list deployments
vercel logs <url>        # tail logs for a deployment
vercel env ls            # list environment variables
vercel --prod            # deploy to production
```

---

## 14. Cost Breakdown

Vercel's pricing is usage-based, and a hobby/free tier covers small projects. Because there is no always-on server, you are not paying for idle compute.

| Service | Free / Included | If you grow |
|---------|-----------------|-------------|
| Vercel hosting (frontend + backend) | Hobby tier covers small projects | Pro plan (per-seat) once you need team features/limits |
| Vercel serverless functions | Generous free invocation/compute allowance | Pay for extra function execution beyond the included amount |
| Vercel CDN / bandwidth | Included allowance | Pay for bandwidth above the included amount |
| Vercel Blob | Free storage/transfer allowance | Pay per GB stored + transferred above the allowance |
| Neon DB | 0.5 GB free forever | ~$19/month for the paid tier |

**Early stage:** essentially **$0/month** while everything fits in the free tiers.
**As you grow:** mainly the Neon paid tier plus any Vercel usage above the included allowances.

### How to monitor costs
1. In the Vercel dashboard, open **Usage** to see function invocations, bandwidth, and Blob usage.
2. Set up **spend management / usage alerts** in Vercel so you're notified before limits are hit.
3. Check the Neon console for database usage against your plan.

---

## 15. Glossary

| Term | Plain English |
|------|-------------|
| **Vercel** | The cloud platform that builds, hosts, and serves the frontend and backend, with a global CDN and automatic HTTPS. |
| **Vercel project** | A single deployable app on Vercel. We have two: one frontend, one backend. |
| **Serverless function** | Code that Vercel runs on demand per request, with no always-on server. Our NestJS backend runs this way. |
| **`@codegenie/serverless-express`** | The adapter that lets the existing NestJS/Express app run inside a Vercel serverless function. |
| **Git integration** | Vercel's link to the repo: pushing code triggers an automatic build and deploy. |
| **Preview deployment** | A temporary deploy for a branch or pull request, so you can test changes before they go live. |
| **`VERCEL_ENV`** | An environment variable Vercel sets automatically (`production`, `preview`, or `development`); the backend uses it to pick prod config. |
| **Environment Variable** | A named secret/config value stored in the Vercel project, injected into the build and runtime. Replaces a separate secrets vault. |
| **Custom domain** | A friendly domain (e.g. `app.fabrixr.com`) mapped onto a Vercel project. |
| **SSL/TLS** | Encryption for HTTPS (the lock icon). Vercel provisions and renews certificates automatically. |
| **CDN** | Content Delivery Network — Vercel's global edge cache that serves files from a location near each user. |
| **Vercel Blob** | Vercel's managed object storage for uploaded files; the database only stores a pointer (`storage_key`). |
| **`storage_key`** | The path-like key naming a file in Blob storage; stored in the database instead of the file bytes. |
| **Request body limit (~4.5 MB)** | The serverless cap on request size; large uploads go straight to Blob instead of through the API. |
| **Neon** | The cloud-hosted PostgreSQL database provider (independent of the hosting platform). |
| **Neon branch** | An isolated copy of the database (e.g. `pcs-dev-db` for dev), keeping dev data separate from prod. |
| **Connection pooling** | Reusing a shared pool of database connections (the `-pooler` host) — essential for serverless. |
| **JWT** | JSON Web Token — a signed token that proves a user is logged in. |
| **CORS** | Cross-Origin Resource Sharing — browser security that controls which websites can call your API. |
| **Vercel CLI** | The `vercel` command-line tool, used by the GitHub Actions workflow (and optionally by hand) to deploy. |

---

## Quick Reference Card

```
╔═══════════════════════════════════════════════════════════╗
║                   FABRIXR PLATFORM                        ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  FRONTEND (Vercel project):                               ║
║  PROD:    https://app.fabrixr.com                         ║
║  STAGING: https://demo.fabrixr.com                        ║
║  DEV:     frontend-git-dev-...vercel.app                  ║
║                                                           ║
║  BACKEND (Vercel serverless project):                     ║
║  PROD:    https://api.fabrixr.com (+ pcsapi.fabrixr.com)  ║
║  STAGING: https://demo-api.fabrixr.com                    ║
║  DEV:     backend-git-dev-...vercel.app                   ║
║                                                           ║
║  DATABASE:  Neon PostgreSQL (dev branch: pcs-dev-db)      ║
║  STORAGE:   Vercel Blob (STORAGE_TYPE=vercel-blob)        ║
║                                                           ║
║  DEPLOY:    git push  →  Vercel builds & deploys          ║
║  CONFIG:    frontend/vercel.json, backend/vercel.json     ║
║  SECRETS:   Vercel Project → Environment Variables        ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
```

---

*Document created: June 2026*
*Last updated: June 2026*
*Platform: FabriXR — hosted on Vercel, database on Neon*
