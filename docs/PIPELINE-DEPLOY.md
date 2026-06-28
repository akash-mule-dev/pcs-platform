# Processing pipeline deployment (BullMQ worker)

How to make IFC/CAD **import + 3D conversion** work on the deployed environment.

## Why this exists

Vercel serverless **cannot** run the pipeline: the function freezes the instant
it responds (killing the background work), caps at 60s, has a ~4.5 MB body cap,
and the build deletes `web-ifc`/`@gltf-transform`. The pipeline needs a
long-running process. So the architecture is **hybrid**:

```
dev.fabrixr.com (Angular, Vercel)
        │ REST
        ▼
demo-api.fabrixr.com (NestJS API, Vercel serverless)   ── producer
        │ enqueue {extract|convert}
        ▼
Upstash Redis  ── durable BullMQ queues: pcs-import, pcs-conversion
        │
        ▼
Railway worker  (npm run worker, this repo's Dockerfile)  ── consumer
   extract (web-ifc) → assembly_nodes → convert (gltf-transform) → GLB → Blob
        │ progress + model events
        ▼
Ably  → live import:progress to the browser
Neon (DB) + Vercel Blob (files) are shared by API + worker.
```

The API and worker are the **same codebase** (one repo), deployed as two
services with different start commands — `node dist/main.js` vs
`node dist/conversion/worker.js`. Do **not** split into separate repos: they
share entities, the DB schema, and the BullMQ job contract, which must never
drift. Phase 0 (committed) made the import pipeline use the durable queue; it's
**inert without `REDIS_URL`**, so the steps below are what "turn it on."

---

## Phase 1 — DEV (do this first)

### 1. Upstash Redis (the queue)
1. https://upstash.com → create a **Redis** database (free tier), region near
   the Railway worker.
2. Copy the **TLS** connection string (`rediss://default:<pwd>@<name>.upstash.io:6379`).

### 2. Railway worker (the consumer)
1. https://railway.app → New Project → **Deploy from GitHub repo** → this repo.
2. Service settings:
   - **Root Directory:** `backend` (so Railway reads `backend/railway.toml` +
     `backend/Dockerfile`).
   - Start command is already set by `railway.toml` → `node dist/conversion/worker.js`.
     No public port is needed (it's a queue consumer, not an HTTP server).
3. **Variables** (Settings → Variables) — values come from `backend/.env`:
   | Key | Value |
   |-----|-------|
   | `DATABASE_URL` | dev Neon **pooled** string (the `ep-red-hall-…-pooler` URL in `backend/.env`) |
   | `DB_SSL` | `true` |
   | `STORAGE_TYPE` | `vercel-blob` |
   | `PCS_DEV_BLOB_READ_WRITE_TOKEN` | from `backend/.env` |
   | `PCS_DEV_BLOB_STORE_ID` | from `backend/.env` |
   | `REDIS_URL` | the Upstash `rediss://…` URL from step 1 |
   | `CONVERSION_DRIVER` | `bullmq` |
   | `JWT_SECRET` | **same value** as the Vercel API (from `backend/.env`) |
   | `NODE_ENV` | `production` |
   - Do **NOT** set `VERCEL_ENV`.
4. Deploy. In **Logs** confirm:
   `Worker listening on 'pcs-import' (concurrency 2) + 'pcs-conversion' (concurrency 2)`.

### 3. Vercel API (the producer)
1. Vercel → the **backend** project → Settings → Environment Variables
   (**Preview** scope = the `dev` branch / demo-api):
   - `REDIS_URL` = the same Upstash URL.
   - `CONVERSION_DRIVER` = `bullmq`.
2. **Redeploy** demo-api so the new env takes effect (the dev backend pins env at
   build time): `vercel redeploy <demo-api deployment URL>` (or trigger a `dev`
   redeploy from the dashboard).

### 4. Verify on dev.fabrixr.com
1. Create a project → import `post_base_detailed.ifc` (small). The import bar
   should advance **uploaded → extracting → persisting → converting → completed**
   live (now over Ably, not just polling), and the 3D model appears.
2. Railway logs show `Import job <id> completed`.
3. Import a **large/real model** (e.g. the 1,800-part Truss) and a **ZIP**
   package — confirm both finish (this is the case Vercel's 60s + 4.5 MB caps
   made impossible).

### Rollback (instant, no data loss)
Remove `REDIS_URL` (or set `CONVERSION_DRIVER=inline`) on the Vercel API and
redeploy → the API reverts to the old inline behavior. (Imports won't process on
serverless, but nothing breaks; the worker can stay up.)

---

## Phase 2 — PROD (after DEV is proven)
Repeat with prod resources, then cut over off-hours:
1. A **separate** Upstash DB + a Railway worker pointed at the **prod** Neon
   branch + prod Blob token + prod `JWT_SECRET`.
2. Add `REDIS_URL` + `CONVERSION_DRIVER=bullmq` to the Vercel backend
   **Production** env; redeploy `api.fabrixr.com`.
3. Smoke-test one import into a scratch project, then announce. Keep the previous
   deploy for instant rollback (remove the env vars) for 1–2 weeks.

## Phase 3 — hardening (later)
Once stable: delete the `vercel-build` `rm -rf node_modules/...` hack + the
Terser `keep_classnames/keep_fnames` workaround (serverless-only), move `@Cron`
jobs in-process on a worker, generate a baseline migration and set
`DB_SYNCHRONIZE=false`, then land Postgres RLS.

---

## Troubleshooting
- **Import stuck at `queued`** → the worker isn't running / can't reach Redis.
  Check Railway logs + that `REDIS_URL` matches on both API and worker.
- **Worker crashes on boot: "Vercel Blob storage requires a token"** → the Blob
  token env var is missing on the worker.
- **`startImport` is slow/failing when Redis is down** → expected: the producer
  fails fast (10s) and marks the import failed (retryable) rather than hanging.
- **Native/WASM dep fails on Alpine** → change the `backend/Dockerfile` base to
  `node:20-slim` (debian) and redeploy the worker.
- **Upstash free-tier limits** (commands/day, connections) → upgrade the Upstash
  plan; the producer uses a bounded connection (`connectTimeout`/`commandTimeout`).

## Local BullMQ test (optional, before deploying)
```bash
docker run -d --rm --name r -p 6380:6379 redis:7-alpine
cd backend && npm run build
# producer:
REDIS_URL=redis://localhost:6380 CONVERSION_DRIVER=bullmq PORT=3001 node dist/main.js &
# worker:
REDIS_URL=redis://localhost:6380 CONVERSION_DRIVER=bullmq node dist/conversion/worker.js &
# import against :3001 → the worker processes it.
```
