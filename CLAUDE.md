# PCS Platform — Claude Code Instructions

Full-stack production-coordination app.
- **Frontend:** Angular 17 — `frontend/`, dev server on port 4200
- **Backend:** NestJS 11 (REST + Socket.io) — `backend/`, port 3000
- **Mobile:** React Native + Expo — `mobile/`
- **Database:** PostgreSQL — the configured `backend/.env` points at a remote **Neon** instance

## Execution style — work autonomously, end-to-end

- Complete tasks **fully** without stopping to ask "should I continue?" between steps.
  Decide on the best approach, then implement **all** of it.
- For a large task, do the thinking up front (optionally propose a short plan), then
  execute every step in one pass — don't pause to check in after each chunk.
- Break complex work into substeps internally, but carry them all out before handing back.
- **Always verify before declaring done:** build it, run the relevant tests, and/or start
  the app and exercise the change. Report results honestly (if tests fail, say so).
- Only stop early for a genuine blocker you cannot resolve yourself: an ambiguous
  requirement, a missing secret/credential, or a destructive/irreversible action that
  needs sign-off. Otherwise, keep going to completion.

## Running the app (verified)

The `nest` and `ng` CLI bin shims are missing from `node_modules/.bin`, so the documented
`npm start` / `npm run start:dev` commands fail with "not recognized". Invoke the CLIs
directly with `node` instead:

- **Backend (dev):** `cd backend && node node_modules/@nestjs/cli/bin/nest.js start --watch`
  → http://localhost:3000 (connects to the remote Neon DB — no local Postgres/Docker needed)
- **Frontend (dev):** `cd frontend && node node_modules/@angular/cli/bin/ng.js serve --port 4200`
  → http://localhost:4200 (calls the backend directly via `environment.ts` → `http://localhost:3000/api`)
- **Backend build / type-check:** `cd backend && node node_modules/@nestjs/cli/bin/nest.js build`
  — runs full `tsc`; catches type errors that `start --watch` (transpile-only) silently skips.
  Run this before claiming the backend is healthy.

The default web login is prefilled on the login screen (Neon dataset, admin role).
