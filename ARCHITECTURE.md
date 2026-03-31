# PCS Platform — Production Control System

## Architecture Document

**Version:** 1.0
**Date:** February 20, 2026

---

## 1. Overview

A single-product production control platform with three clients (web, mobile-operator, API) and one NestJS backend. The core differentiator is **real-time per-operator, per-stage time tracking**.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend (Web) | Angular 17+ with Angular Material |
| Mobile App | React Native + Expo (SDK 52) |
| Backend | NestJS 10+ (TypeScript) |
| Database | PostgreSQL 16 |
| ORM | TypeORM |
| Auth | JWT (passport-jwt) with role-based guards |
| API Style | REST (OpenAPI/Swagger documented) |
| Real-time | WebSocket (Socket.IO via @nestjs/websockets) |

---

## 2. Project Structure

```
pcs-platform/
├── backend/                   # NestJS API
│   ├── src/
│   │   ├── auth/              # JWT auth, login, guards, role decorator
│   │   ├── users/             # User CRUD, roles, badge management
│   │   ├── products/          # Manufactured products
│   │   ├── processes/         # Production process templates
│   │   ├── stages/            # Stages within processes
│   │   ├── lines/             # Production lines
│   │   ├── stations/          # Workstations on lines
│   │   ├── work-orders/       # Work order lifecycle
│   │   ├── time-tracking/     # Clock in/out, time entries ⭐
│   │   ├── dashboard/         # Aggregated KPIs & live status
│   │   ├── database/          # TypeORM config, migrations
│   │   ├── seed/              # Seed data
│   │   ├── common/            # Shared DTOs, pipes, interceptors
│   │   └── websocket/         # Real-time gateway (Socket.IO)
│   └── ...
├── frontend/                  # Angular web app
│   ├── src/app/
│   │   ├── core/              # Auth service, guards, interceptors
│   │   ├── shared/            # Shared components, pipes, directives
│   │   ├── layout/            # Shell, sidebar, header
│   │   ├── auth/              # Login page
│   │   ├── dashboard/         # Main dashboard with KPIs
│   │   ├── products/          # Product management
│   │   ├── processes/         # Process & stage designer
│   │   ├── work-orders/       # Work order management
│   │   ├── time-tracking/     # Time tracking views (live, history)
│   │   ├── users/             # User management
│   │   ├── stations/          # Stations & lines management
│   │   └── reports/           # Analytics & reports
│   └── ...
├── mobile/                    # React Native + Expo app
│   ├── src/
│   │   ├── components/        # Shared UI components
│   │   ├── config/            # Environment configuration
│   │   ├── context/           # React context (Auth, etc.)
│   │   ├── navigation/        # React Navigation (tabs, stacks)
│   │   ├── screens/           # App screens
│   │   │   ├── auth/          # Login screen
│   │   │   ├── dashboard/     # Operator dashboard
│   │   │   ├── work-orders/   # View assigned work orders
│   │   │   ├── time-tracking/ # Clock in/out UI ⭐
│   │   │   ├── model-viewer/  # 3D/AR model viewer
│   │   │   └── profile/       # Operator profile & stats
│   │   ├── services/          # API, auth, offline, caching
│   │   ├── theme/             # Colors and styling
│   │   └── utils/             # Utility functions
│   └── ...
└── ARCHITECTURE.md
```

---

## 3. Database Schema

### Entity Relationship

```
Role (1) ──< User (1) ──< TimeEntry (>1)
                │                  │
                │                  ▼
                │         WorkOrderStage (>1) ──> Stage (>1) ──> Process (1) ──> Product (1)
                │                  │
                └──< WorkOrder (1) ┘
                          │
                  Line (1) ──< Station (>1)
```

### Tables

#### roles
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| name | VARCHAR(50) UNIQUE | admin, manager, supervisor, operator |
| description | TEXT | |
| created_at | TIMESTAMP | |

#### users
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| employee_id | VARCHAR(50) UNIQUE | |
| email | VARCHAR(255) UNIQUE | |
| password_hash | VARCHAR(255) | bcrypt |
| first_name | VARCHAR(100) | |
| last_name | VARCHAR(100) | |
| badge_id | VARCHAR(50) UNIQUE NULL | |
| role_id | UUID FK → roles | |
| is_active | BOOLEAN DEFAULT true | |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

#### products
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| name | VARCHAR(255) | |
| sku | VARCHAR(100) UNIQUE | |
| description | TEXT | |
| is_active | BOOLEAN DEFAULT true | |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

#### processes
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| name | VARCHAR(255) | |
| version | INTEGER DEFAULT 1 | |
| product_id | UUID FK → products | |
| is_active | BOOLEAN DEFAULT true | |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

**UNIQUE constraint on (product_id, version)**

#### stages
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| process_id | UUID FK → processes ON DELETE CASCADE | |
| name | VARCHAR(255) | |
| sequence | INTEGER | Order within process |
| target_time_seconds | INTEGER | Target duration |
| description | TEXT | |
| is_active | BOOLEAN DEFAULT true | |
| created_at | TIMESTAMP | |

**UNIQUE constraint on (process_id, sequence)**

#### lines
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| name | VARCHAR(255) UNIQUE | |
| description | TEXT | |
| is_active | BOOLEAN DEFAULT true | |
| created_at | TIMESTAMP | |

#### stations
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| name | VARCHAR(255) | |
| line_id | UUID FK → lines | |
| is_active | BOOLEAN DEFAULT true | |
| created_at | TIMESTAMP | |

**UNIQUE constraint on (name, line_id)**

#### work_orders
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| order_number | VARCHAR(50) UNIQUE | Auto-generated WO-YYYY-NNNN |
| product_id | UUID FK → products | |
| process_id | UUID FK → processes | |
| line_id | UUID FK → lines NULL | |
| quantity | INTEGER | |
| completed_quantity | INTEGER DEFAULT 0 | |
| status | ENUM('draft','pending','in_progress','completed','cancelled') | |
| priority | ENUM('low','medium','high','urgent') DEFAULT 'medium' | |
| due_date | TIMESTAMP NULL | |
| started_at | TIMESTAMP NULL | |
| completed_at | TIMESTAMP NULL | |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

#### work_order_stages
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| work_order_id | UUID FK → work_orders ON DELETE CASCADE | |
| stage_id | UUID FK → stages | |
| assigned_user_id | UUID FK → users NULL | |
| station_id | UUID FK → stations NULL | |
| status | ENUM('pending','in_progress','completed','skipped') DEFAULT 'pending' | |
| started_at | TIMESTAMP NULL | |
| completed_at | TIMESTAMP NULL | |
| actual_time_seconds | INTEGER NULL | |
| created_at | TIMESTAMP | |

#### time_entries ⭐
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| user_id | UUID FK → users | |
| work_order_stage_id | UUID FK → work_order_stages | |
| station_id | UUID FK → stations NULL | |
| start_time | TIMESTAMP | |
| end_time | TIMESTAMP NULL | NULL = currently active |
| duration_seconds | INTEGER NULL | Computed on end |
| break_seconds | INTEGER DEFAULT 0 | |
| idle_seconds | INTEGER DEFAULT 0 | |
| input_method | ENUM('web','mobile','badge','kiosk') DEFAULT 'web' | |
| is_rework | BOOLEAN DEFAULT false | |
| notes | TEXT NULL | |
| created_at | TIMESTAMP | |

**INDEX on (user_id, end_time) WHERE end_time IS NULL** — for finding active entries

---

## 4. API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/login | Login → JWT token |
| GET | /api/auth/profile | Get current user |

### Users
| Method | Endpoint | Roles |
|--------|----------|-------|
| GET | /api/users | admin, manager |
| GET | /api/users/:id | all |
| POST | /api/users | admin |
| PATCH | /api/users/:id | admin |
| DELETE | /api/users/:id | admin |

### Products
| Method | Endpoint | Roles |
|--------|----------|-------|
| GET | /api/products | all |
| GET | /api/products/:id | all |
| POST | /api/products | admin, manager |
| PATCH | /api/products/:id | admin, manager |
| DELETE | /api/products/:id | admin |

### Processes & Stages
| Method | Endpoint | Roles |
|--------|----------|-------|
| GET | /api/processes | all |
| GET | /api/processes/:id | all (includes stages) |
| POST | /api/processes | admin, manager |
| PATCH | /api/processes/:id | admin, manager |
| DELETE | /api/processes/:id | admin |
| POST | /api/processes/:id/stages | admin, manager |
| PATCH | /api/stages/:id | admin, manager |
| DELETE | /api/stages/:id | admin, manager |
| PATCH | /api/processes/:id/stages/reorder | admin, manager |

### Lines & Stations
| Method | Endpoint | Roles |
|--------|----------|-------|
| GET | /api/lines | all |
| POST | /api/lines | admin, manager |
| PATCH | /api/lines/:id | admin, manager |
| GET | /api/lines/:id/stations | all |
| POST | /api/stations | admin, manager |
| PATCH | /api/stations/:id | admin, manager |

### Work Orders
| Method | Endpoint | Roles |
|--------|----------|-------|
| GET | /api/work-orders | all |
| GET | /api/work-orders/:id | all (includes stages) |
| POST | /api/work-orders | admin, manager, supervisor |
| PATCH | /api/work-orders/:id | admin, manager, supervisor |
| PATCH | /api/work-orders/:id/status | admin, manager, supervisor |
| POST | /api/work-orders/:id/assign | supervisor+ |

### Time Tracking ⭐
| Method | Endpoint | Roles |
|--------|----------|-------|
| POST | /api/time-tracking/clock-in | operator, supervisor |
| POST | /api/time-tracking/clock-out | operator, supervisor |
| GET | /api/time-tracking/active | all (current active entries) |
| GET | /api/time-tracking/history | all (with filters) |
| GET | /api/time-tracking/user/:userId | supervisor+ |
| PATCH | /api/time-tracking/:id | supervisor+ (corrections) |

### Dashboard
| Method | Endpoint | Roles |
|--------|----------|-------|
| GET | /api/dashboard/summary | all |
| GET | /api/dashboard/live-status | all |
| GET | /api/dashboard/operator-performance | supervisor+ |
| GET | /api/dashboard/stage-analytics | manager+ |
| GET | /api/dashboard/work-order-progress/:id | all |

---

## 5. Auth Flow

1. User POSTs email + password to `/api/auth/login`
2. Backend validates, returns `{ accessToken: "jwt...", user: {...} }`
3. JWT contains: `{ sub: userId, email, role, employeeId }`
4. Frontend/mobile stores token, sends as `Authorization: Bearer <token>`
5. NestJS `JwtAuthGuard` validates on protected routes
6. `RolesGuard` checks `@Roles('admin', 'manager')` decorator

### Roles hierarchy
- **admin** — full system access
- **manager** — manage processes, work orders, view all analytics
- **supervisor** — manage work orders, assign operators, view team analytics
- **operator** — clock in/out, view own assignments and performance

---

## 6. Seed Data

### Users (password for all: `password123`)

| Email | Role | Name |
|-------|------|------|
| admin@pcs.local | admin | System Admin |
| manager@pcs.local | manager | Production Manager |
| supervisor1@pcs.local | supervisor | Line 1 Supervisor |
| supervisor2@pcs.local | supervisor | Line 2 Supervisor |
| operator1@pcs.local | operator | John Smith |
| operator2@pcs.local | operator | Maria Chen |
| operator3@pcs.local | operator | Ahmed Kumar |
| operator4@pcs.local | operator | Lisa Johnson |
| operator5@pcs.local | operator | Carlos Rodriguez |

### Products
- PCB-X100 (Circuit Board Assembly)
- MOT-200 (Electric Motor Unit)
- SEN-50 (Temperature Sensor Module)

### Processes & Stages

**PCB Assembly (PCB-X100):**
1. Component Preparation (600s target)
2. SMT Placement (900s)
3. Reflow Soldering (1200s)
4. Inspection (600s)
5. Through-Hole Assembly (900s)
6. Wave Soldering (800s)
7. Quality Control (600s)
8. Packaging (300s)

**Motor Assembly (MOT-200):**
1. Stator Winding (1800s)
2. Rotor Assembly (1200s)
3. Housing Preparation (600s)
4. Final Assembly (1500s)
5. Electrical Testing (900s)
6. Quality Inspection (600s)
7. Packaging (300s)

**Sensor Module (SEN-50):**
1. PCB Prep (300s)
2. Sensor Mounting (600s)
3. Calibration (900s)
4. Enclosure Assembly (450s)
5. Final Test (600s)
6. Packaging (200s)

### Lines & Stations
- **Line 1** (PCB Assembly): Stations ST-1A through ST-1F
- **Line 2** (Motor Assembly): Stations ST-2A through ST-2E
- **Line 3** (Sensor Module): Stations ST-3A through ST-3D

### Work Orders (sample)
- WO-2026-0001: PCB-X100, qty 100, in_progress, high priority
- WO-2026-0002: MOT-200, qty 50, pending, medium priority
- WO-2026-0003: SEN-50, qty 200, in_progress, urgent
- WO-2026-0004: PCB-X100, qty 75, draft, low priority
- WO-2026-0005: MOT-200, qty 30, completed, medium priority

### Sample Time Entries
Seed ~50 time entries across operators, various stages, with realistic duration variances around target times. Include a few active (no end_time) entries for live dashboard testing.

---

## 7. WebSocket Events

| Event | Direction | Payload |
|-------|-----------|---------|
| `clock-in` | client→server | `{ workOrderStageId, stationId?, inputMethod }` |
| `clock-out` | client→server | `{ timeEntryId, notes? }` |
| `stage-update` | server→client | `{ workOrderStageId, status, userId, timestamp }` |
| `time-entry-update` | server→client | `{ timeEntry }` |
| `dashboard-refresh` | server→client | `{ summary }` |

---

## 8. Frontend Pages

### Web App (Angular)

| Page | Route | Description |
|------|-------|-------------|
| Login | /login | Email + password |
| Dashboard | / | KPI cards, live stage status, charts |
| Products | /products | List, create, edit products |
| Processes | /processes | List processes; detail view shows stages |
| Process Detail | /processes/:id | Stage list with drag-reorder, target times |
| Work Orders | /work-orders | List with filters (status, priority, date) |
| Work Order Detail | /work-orders/:id | Stage progress, assignments, time entries |
| Time Tracking Live | /time-tracking | Live view: who's working on what |
| Time Tracking History | /time-tracking/history | Filterable history table |
| Users | /users | User management (admin) |
| Stations | /stations | Lines & stations management |
| Reports | /reports | Operator performance, stage analytics charts |

### Mobile App (React Native + Expo)

| Screen | Stack/Tab | Description |
|--------|-----------|-------------|
| Login | Auth Stack | Email + password |
| Dashboard | Home Tab | Assigned work, current status |
| Work Orders | Work Orders Tab | Operator's assigned work orders |
| Work Order Detail | Work Orders Stack | Stage progress, clock in/out, timer |
| Time Tracking | Time Tracking Tab | Active timer, clock in/out ⭐ |
| Model Viewer | Model Viewer Tab | 3D/AR model viewer |
| Profile | Profile Tab | Own stats and performance |

---

## 9. Key Implementation Notes

1. **TypeORM with migrations** — use `synchronize: false` in prod, migrations for schema
2. **Validation** — class-validator + class-transformer on all DTOs
3. **Swagger** — auto-generated at `/api/docs`
4. **CORS** — configured for frontend (4200); mobile app connects directly via device network
5. **Pagination** — all list endpoints support `?page=1&limit=20`
6. **Filtering** — work orders by status, priority; time entries by date range, user
7. **Error handling** — global exception filter with consistent error format
8. **UUID primary keys** — all entities use UUID v4
