# PCS Platform — Technology Stack

> Complete overview of all technologies, libraries, and services used in the PCS Platform.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENTS                                  │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Web Browser  │  │ Android App  │  │  iOS App     │          │
│  │ (Angular 17) │  │(React Native)│  │(React Native)│          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                  │                  │                   │
│         └──────────────────┼──────────────────┘                  │
│                            │                                     │
│                      REST API + WebSocket                        │
│                            │                                     │
│  ┌─────────────────────────▼─────────────────────────────────┐  │
│  │              BACKEND (NestJS + TypeORM)                     │  │
│  │                                                            │  │
│  │  Auth → Users → Products → Processes → Stages              │  │
│  │  Lines → Stations → Work Orders → Time Tracking            │  │
│  │  Dashboard → Seed → WebSocket                              │  │
│  └─────────────────────────┬─────────────────────────────────┘  │
│                            │                                     │
│                     ┌──────▼──────┐                              │
│                     │ PostgreSQL  │                              │
│                     │ (Neon)      │                              │
│                     └─────────────┘                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Frontend (Web)

| Technology | Version | Purpose |
|-----------|---------|---------|
| **Angular** | 17 | SPA framework |
| **Angular Material** | 17 | UI component library (tables, cards, dialogs, forms) |
| **Chart.js** | 4.x | Dashboard charts (doughnut, bar, line) |
| **RxJS** | 7.x | Reactive programming, HTTP interceptors |
| **TypeScript** | 5.x | Type-safe JavaScript |

### Key Features
- **11 Pages:** Login, Dashboard, Products, Processes, Work Orders, Stations, Time Tracking (live + history), Users, Reports
- **Interceptors:** JWT auth token injection, response unwrapping (`{data:...}`)
- **Guards:** Route protection based on authentication
- **Environment Configs:** dev, stage, production with different API URLs
- **Material Design:** Consistent UI with shadows, hover effects, responsive layout

### Build Output
- Compiled to static HTML/CSS/JS files
- Hosted on S3 (no server needed)
- Served via CloudFront CDN with HTTPS

---

## Backend (API)

| Technology | Version | Purpose |
|-----------|---------|---------|
| **NestJS** | 10.x | Node.js framework (modular, TypeScript-first) |
| **TypeORM** | 0.3.x | Database ORM (entities, migrations, relations) |
| **PostgreSQL** | 16 | Relational database (via Neon) |
| **Passport.js** | 0.7.x | Authentication middleware |
| **JWT** | - | Stateless authentication tokens |
| **bcrypt** | - | Password hashing |
| **Swagger** | - | Auto-generated API documentation |
| **Socket.IO** | 4.x | Real-time WebSocket communication |
| **class-validator** | - | DTO validation (decorators) |
| **class-transformer** | - | Object transformation |
| **dotenv** | - | Environment variable loading |

### API Modules (16 total)
| Module | Endpoints | Description |
|--------|-----------|-------------|
| **Auth** | POST /login, GET /profile | JWT login, token validation |
| **Users** | CRUD | User management with roles |
| **Products** | CRUD | Product catalog (SKU, name, description) |
| **Processes** | CRUD | Manufacturing process definitions |
| **Stages** | CRUD | Process stages with ordering |
| **Lines** | CRUD | Production line management |
| **Stations** | CRUD | Station assignment to lines |
| **Work Orders** | CRUD + status | Work order lifecycle tracking |
| **Time Tracking** | Clock in/out, history | Operator time entries |
| **Dashboard** | GET stats, charts | KPIs, work order status, analytics |
| **Seed** | Auto-run | Sample data for all entities |
| **WebSocket** | Real-time events | Live updates across clients |
| **Database** | - | TypeORM connection (supports URL + individual params + SSL) |
| **Common** | - | Filters, interceptors, guards |

### API Documentation
Swagger UI available at `/api/docs` on each environment.

### Authentication Flow
```
1. Client sends POST /api/auth/login { email, password }
2. Backend validates credentials against DB (bcrypt compare)
3. Returns JWT token + user object (with role)
4. Client stores token, sends in Authorization header
5. JwtAuthGuard validates token on protected routes
6. RolesGuard checks user role against required roles
```

### Role Hierarchy
| Role | Access Level |
|------|-------------|
| Admin | Full access — all modules, user management |
| Manager | Work orders, reports, dashboard, processes |
| Supervisor | Work orders, time tracking, stations |
| Operator | Own time tracking, assigned work orders |

---

## Mobile App

| Technology | Version | Purpose |
|-----------|---------|---------|
| **React Native** | 0.76 | Cross-platform native mobile framework |
| **Expo** | SDK 52 | Development toolchain, build service, OTA updates |
| **React Navigation** | 7.x | Navigation (tabs, stacks) |
| **AsyncStorage** | 2.x | Local storage (auth tokens) |
| **React Viro** | 2.x | AR features |
| **Expo Camera** | 16.x | Camera access for AR |

### Mobile Screens (5 Tabs)
| Tab | Features |
|-----|----------|
| **Dashboard** | Greeting, active timer, order count, today's stats |
| **Work Orders** | Work order list with status badges, search |
| **Time Tracking** | Live clock-in/out, station selection, duration counter |
| **Model Viewer** | 3D/AR model viewer |
| **Profile** | User info, employee ID, weekly stats, logout |

### Platform Support
| Platform | Status | Build Tool |
|----------|--------|------------|
| Android | ✅ Supported | Expo / EAS Build |
| iOS | ✅ Supported | Expo / EAS Build (requires Mac for local) |
| Web | ✅ Expo Web | `expo start --web` |

### App Configuration
- **Bundle ID:** `com.primeterminal.pcs`
- **App Name:** PCS
- **Icons:** Configured in `assets/` directory
- **Splash Screen:** Blue theme (#1565c0) with PCS branding
- **Expo Config:** `app.json`

---

## Infrastructure & DevOps

| Technology | Purpose |
|-----------|---------|
| **AWS EC2** (t3.micro) | Backend server hosting |
| **AWS S3** | Frontend static hosting (3 buckets) |
| **AWS CloudFront** | CDN + HTTPS for prod frontend & landing page |
| **AWS ACM** | Free SSL certificate (wildcard) |
| **AWS SSM Parameter Store** | Secrets management (DB URLs, JWT keys) |
| **Neon** | Managed PostgreSQL database |
| **PM2** | Node.js process manager (auto-restart, logging) |
| **Nginx** | Reverse proxy for subdomains |
| **GitHub** | Source code repository (private) |
| **GitHub Pages** | Landing page hosting |
| **GoDaddy** | Domain registrar + DNS |

### Environment Architecture
```
                    primeterminaltech.com
                            │
              ┌─────────────┼─────────────────┐
              │             │                  │
         www/root          app               api
     CloudFront CDN    CloudFront CDN      EC2 Nginx
         │                 │                  │
    GitHub Pages     S3 Prod Bucket     PM2 (port 3000)
   (Landing Page)    (Angular App)     (NestJS Backend)
                                             │
                                        Neon PostgreSQL
```

---

## Development Tools

| Tool | Purpose |
|------|---------|
| **VS Code** | Code editor |
| **Git** | Version control |
| **npm** | Package management |
| **Angular CLI** | Frontend scaffolding & builds |
| **Nest CLI** | Backend scaffolding & builds |
| **Expo CLI** | Mobile development |
| **EAS CLI** | Mobile builds & app store submission |
| **AWS CLI** | AWS resource management |
| **GitHub CLI** (`gh`) | Repo management, Pages deployment |
| **psql** | Database CLI client |
| **ImageMagick** | Icon/splash screen generation |

---

## Repositories

| Repo | Visibility | URL |
|------|-----------|-----|
| `pcs-platform` | Private | https://github.com/akash-mule-dev/pcs-platform |
| `pcs-website` | Public | https://github.com/akash-mule-dev/pcs-website |

### pcs-platform Structure
```
pcs-platform/
├── backend/              # NestJS API
│   ├── src/
│   │   ├── auth/         # JWT authentication
│   │   ├── users/        # User management
│   │   ├── products/     # Product CRUD
│   │   ├── processes/    # Process definitions
│   │   ├── stages/       # Stage management
│   │   ├── lines/        # Production lines
│   │   ├── stations/     # Station management
│   │   ├── work-orders/  # Work order tracking
│   │   ├── time-tracking/# Clock in/out
│   │   ├── dashboard/    # Analytics & KPIs
│   │   ├── seed/         # Sample data
│   │   ├── websocket/    # Real-time events
│   │   ├── database/     # TypeORM config
│   │   └── common/       # Guards, filters, interceptors
│   └── package.json
├── frontend/             # Angular 17 SPA
│   ├── src/
│   │   ├── app/
│   │   │   ├── auth/
│   │   │   ├── dashboard/
│   │   │   ├── products/
│   │   │   ├── processes/
│   │   │   ├── work-orders/
│   │   │   ├── stations/
│   │   │   ├── time-tracking/
│   │   │   ├── users/
│   │   │   ├── reports/
│   │   │   └── layout/
│   │   └── environments/  # dev, stage, prod configs
│   └── package.json
├── mobile-rn/            # React Native + Expo (SDK 52)
│   ├── src/
│   │   ├── components/   # Shared UI components
│   │   ├── config/       # Environment configuration
│   │   ├── context/      # React context (Auth)
│   │   ├── navigation/   # React Navigation setup
│   │   ├── screens/      # App screens
│   │   ├── services/     # API, auth, offline, caching
│   │   └── theme/        # Colors and styling
│   ├── assets/           # Icons & splash screens
│   ├── android/          # Native Android project (after prebuild)
│   ├── ios/              # Native iOS project (after prebuild)
│   └── app.json          # Expo configuration
├── docs/                 # Documentation (this folder)
├── docker-compose.yml    # Local dev with Docker
└── .gitignore
```

---

*Document created: February 22, 2026*
