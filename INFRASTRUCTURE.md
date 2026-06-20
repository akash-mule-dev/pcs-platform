# FabriXR / PCS Platform — Infrastructure

## Hosting
- Provider: **Vercel** (Git-integrated, auto-deploys on push)
- Frontend (Angular) and backend (NestJS) are each their own Vercel project
- Backend runs as a Vercel serverless function (`@codegenie/serverless-express`)
- Config: `frontend/vercel.json`, `backend/vercel.json`
- Brand domain: `fabrixr.com`

## Environments

### DEV (preview — `dev` branch)
- **Frontend:** https://dev.fabrixr.com
- **Backend:** https://demo-api.fabrixr.com
- **Swagger:** https://demo-api.fabrixr.com/api/docs
- **Auto-deploy:** pushes to `dev` build the dev config

### STAGING (`demo.fabrixr.com`)
- **Frontend:** https://demo.fabrixr.com
- **Backend:** https://demo-api.fabrixr.com
- **Swagger:** https://demo-api.fabrixr.com/api/docs

### PROD
- **Landing:** https://www.fabrixr.com
- **Frontend:** https://app.fabrixr.com
- **Backend:** https://api.fabrixr.com (also https://pcsapi.fabrixr.com)
- **Swagger:** https://api.fabrixr.com/api/docs
- **Backend config:** prod is selected when `VERCEL_ENV=production`

## Custom Domains (Vercel-managed, automatic SSL)
- `app.fabrixr.com` → prod frontend
- `api.fabrixr.com`, `pcsapi.fabrixr.com` → prod backend
- `demo.fabrixr.com` → staging frontend
- `demo-api.fabrixr.com` → staging backend
- `www.fabrixr.com` → landing

## Database
- Provider: Neon PostgreSQL
- Dev branch: `pcs-dev-db` (isolated from prod)
- Prod connection string is selected only when `VERCEL_ENV=production`
- Connection strings are stored as Vercel project Environment Variables

## Storage
- Provider: **Vercel Blob** (`STORAGE_TYPE=vercel-blob`, default; Azure Blob is the only other option)
- Token: `PCS_DEV_BLOB_READ_WRITE_TOKEN` / `BLOB_READ_WRITE_TOKEN`
- Private store — files are streamed back through the API, never via a public URL

## Secrets / Config
- All secrets live in **Vercel project Environment Variables** (per environment: Production / Preview / Development)
- Never committed to the codebase

## CI/CD
- `.github/workflows/deploy.yml` deploys via the Vercel CLI
- Required GitHub secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`

## Notes
- Serverless request body cap is ~4.5 MB — large package uploads should go straight to Vercel Blob from the client, then hand the backend the key.

## Login Credentials (all environments)
- admin@pcs.local / password123
- manager@pcs.local / password123
- operator1@pcs.local / password123
