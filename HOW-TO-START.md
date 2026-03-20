# How to Start the PCS Platform

## Architecture Overview

PCS Platform is a full-stack application for production coordination:

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│  Frontend   │   │  Mobile App │   │   Swagger    │
│  Angular 17 │   │ Ionic/Angular│   │  API Docs   │
│  :4200/:80  │   │  :8100/:80  │   │  :3000/api  │
└──────┬──────┘   └──────┬──────┘   └──────┬──────┘
       │                 │                  │
       └────────────┬────┘──────────────────┘
                    │
            ┌───────▼───────┐
            │    Backend    │
            │   NestJS 11   │
            │    :3000      │
            │  (REST + WS)  │
            └───────┬───────┘
                    │
            ┌───────▼───────┐
            │  PostgreSQL   │
            │     v16       │
            │  :5433/:5432  │
            └───────────────┘
```

**Key features:** Work orders, product management, CAD file viewing (Three.js / OpenCascade), real-time updates (Socket.io), quality analysis, notifications, audit logging, and search.

---

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- [Docker](https://www.docker.com/) and Docker Compose
- npm (comes with Node.js)

---

## Quick Start with Docker (Recommended)

Start all services (database, backend, frontend, mobile) in one command:

```bash
docker-compose up --build
```

| Service       | URL                          |
| ------------- | ---------------------------- |
| Frontend      | http://localhost             |
| Backend API   | http://localhost:3000        |
| API Docs      | http://localhost:3000/api/docs |
| Mobile Web    | http://localhost:8100        |
| PostgreSQL    | localhost:5433               |

The database is automatically seeded with sample data on first start.

---

## Default Login Credentials

All seeded accounts use the password: **`password123`**

| Email                   | Name                | Role       | Employee ID | Badge ID |
| ----------------------- | ------------------- | ---------- | ----------- | -------- |
| `admin@pcs.local`       | System Admin        | Admin      | EMP-001     | —        |
| `manager@pcs.local`     | Production Manager  | Manager    | EMP-002     | —        |
| `supervisor1@pcs.local` | Line 1 Supervisor   | Supervisor | EMP-003     | —        |
| `supervisor2@pcs.local` | Line 2 Supervisor   | Supervisor | EMP-004     | —        |
| `operator1@pcs.local`   | John Smith          | Operator   | EMP-005     | B-001    |
| `operator2@pcs.local`   | Maria Chen          | Operator   | EMP-006     | B-002    |
| `operator3@pcs.local`   | Ahmed Kumar         | Operator   | EMP-007     | B-003    |
| `operator4@pcs.local`   | Lisa Johnson        | Operator   | EMP-008     | B-004    |
| `operator5@pcs.local`   | Carlos Rodriguez    | Operator   | EMP-009     | B-005    |

> **Tip:** Use `admin@pcs.local` / `password123` for full access to all features.

---

To stop all services:

```bash
docker-compose down
```

To stop and **remove all data** (clean start):

```bash
docker-compose down -v
```

---

## Development Setup (Individual Services)

Run each service separately for hot-reload and debugging.

### 1. Start the Database

```bash
docker-compose up postgres
```

Wait for the health check to pass (the container will show "healthy").

### 2. Start the Backend (NestJS)

```bash
cd backend
npm install
cp .env.example .env    # configure environment variables (see table below)
npm run start:dev       # starts with hot-reload on http://localhost:3000
```

**Important:** When running outside Docker, set these in your `.env`:
```
DB_HOST=localhost
DB_PORT=5433
```

Available backend scripts:

| Command                | Description                   |
| ---------------------- | ----------------------------- |
| `npm run start`        | Start in production mode      |
| `npm run start:dev`    | Start with hot-reload         |
| `npm run start:debug`  | Start with debug + hot-reload |
| `npm run build`        | Build the project             |
| `npm run test`         | Run unit tests                |
| `npm run test:e2e`     | Run end-to-end tests          |

### 3. Start the Frontend (Angular)

```bash
cd frontend
npm install
npm start             # starts on http://localhost:4200
```

The frontend proxies API requests to the backend automatically (configured in `frontend/proxy.conf.json`):
- `/api/*` → http://localhost:3000
- `/socket.io/*` → http://localhost:3000 (WebSocket)

### 4. Start the Mobile App (Ionic/Angular)

```bash
cd mobile
npm install
npm start             # starts on http://localhost:8100
```

---

## Environment Variables

Copy `backend/.env.example` to `backend/.env` and update the values as needed:

| Variable       | Default                      | Description                                      |
| -------------- | ---------------------------- | ------------------------------------------------ |
| `DB_HOST`      | `postgres`                   | Database host (`localhost` for local dev)         |
| `DB_PORT`      | `5432`                       | Database port (`5433` for local dev)              |
| `DB_USER`      | `pcs_user`                   | Database username                                |
| `DB_PASSWORD`  | `pcs_password`               | Database password                                |
| `DB_NAME`      | `pcs_db`                     | Database name                                    |
| `JWT_SECRET`   | `change-this-in-production`  | JWT signing secret — **change in production**    |
| `PORT`         | `3000`                       | Backend server port                              |
| `NODE_ENV`     | `production`                 | Environment mode                                 |
| `CORS_ORIGINS` | `localhost:4200,8100`        | Allowed CORS origins (comma-separated)           |
| `STORAGE_TYPE` | `local`                      | File storage backend: `local`, `s3`, or `azure`  |
| `S3_BUCKET`    | `pcs-models`                 | S3 bucket name (when `STORAGE_TYPE=s3`)          |
| `S3_REGION`    | `us-east-1`                  | AWS region (when `STORAGE_TYPE=s3`)              |

> **Tip:** You can also use `DATABASE_URL` as a connection string instead of individual DB variables.

---

## API Documentation

When the backend is running, interactive Swagger docs are available at:

**http://localhost:3000/api/docs**

This documents all REST endpoints including authentication, work orders, products, search, notifications, and more.

---

## Running Tests

### Backend Unit Tests
```bash
cd backend
npm run test
```

### Backend E2E Tests
```bash
cd backend
npm run test:e2e
```

### Playwright E2E Tests (Full Stack)
```bash
# Ensure all services are running first
npx playwright install    # one-time browser setup
npx playwright test
```

---

## Troubleshooting

| Problem | Solution |
| ------- | -------- |
| Port 5433 already in use | Stop any existing PostgreSQL instances or change the port in `docker-compose.yml` |
| Backend can't connect to DB | Ensure `DB_HOST=localhost` and `DB_PORT=5433` in `.env` when running outside Docker |
| Frontend shows CORS errors | Verify backend is running and `CORS_ORIGINS` includes the frontend URL |
| `npm install` fails in mobile | Run `npm install --legacy-peer-deps` |
| Docker build is slow | Use `docker-compose up` (without `--build`) after the first build |
| File uploads fail | Max upload size is 500MB; check the `uploads/` directory has write permissions |
