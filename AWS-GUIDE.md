# PCS Platform — AWS Infrastructure Guide
### A Complete Walkthrough for Beginners

> This document explains everything we set up on AWS for the PCS Platform — what each piece does, why we need it, and how they all connect together.

---

## Table of Contents
1. [The Big Picture](#1-the-big-picture)
2. [What is AWS?](#2-what-is-aws) — [aws.amazon.com](https://aws.amazon.com/)
3. [IAM — Who Gets Access](#3-iam--who-gets-access) — [AWS IAM](https://aws.amazon.com/iam/)
4. [VPC — Your Private Network](#4-vpc--your-private-network) — [AWS VPC](https://aws.amazon.com/vpc/)
5. [EC2 — Your Server in the Cloud](#5-ec2--your-server-in-the-cloud) — [AWS EC2](https://aws.amazon.com/ec2/)
6. [S3 — File Storage & Website Hosting](#6-s3--file-storage--website-hosting) — [AWS S3](https://aws.amazon.com/s3/)
7. [SSM Parameter Store — Secrets Management](#7-ssm-parameter-store--secrets-management) — [AWS SSM Parameter Store](https://aws.amazon.com/systems-manager/features/parameter-store/)
8. [PM2 — Keeping Your Backend Alive](#8-pm2--keeping-your-backend-alive) — [pm2.keymetrics.io](https://pm2.keymetrics.io/)
9. [Neon DB — Your Database](#9-neon-db--your-database) — [neon.tech](https://neon.tech/)
10. [Dev / Stage / Prod — Why 3 Environments?](#10-dev--stage--prod--why-3-environments)
11. [How Everything Connects](#11-how-everything-connects)
12. [How Code Gets to AWS](#12-how-code-gets-to-aws)
13. [Security — What Protects What](#13-security--what-protects-what)
14. [Common Tasks & Commands](#14-common-tasks--commands)
15. [Cost Breakdown](#15-cost-breakdown)
16. [Glossary](#16-glossary)

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
│   │  S3 Bucket   │         │    EC2 Instance       │              │
│   │  (Frontend)  │ ──API──▶│    (Backend Server)   │              │
│   │              │ calls   │                      │              │
│   │  HTML/CSS/JS │         │  Port 3000 = Prod    │              │
│   │  Static files│         │  Port 3001 = Dev     │              │
│   └─────────────┘         │  Port 3002 = Stage   │              │
│                            │         │            │              │
│                            └─────────┼────────────┘              │
│                                      │                           │
│                                      ▼                           │
│                            ┌──────────────────┐                  │
│                            │   Neon Database    │                 │
│                            │   (PostgreSQL)     │                 │
│                            │   Cloud-hosted     │                 │
│                            └──────────────────┘                  │
└──────────────────────────────────────────────────────────────────┘
```

**In simple terms:**
- Your **frontend** (Angular app) is a bunch of HTML/CSS/JS files sitting in an **S3 bucket** (like a file folder on AWS)
- Your **backend** (NestJS API) runs on an **EC2 instance** (a virtual computer on AWS)
- Your **database** (PostgreSQL) lives on **Neon** (a cloud database provider, separate from AWS)
- When a user opens the website, their browser downloads the frontend from S3, and the frontend makes API calls to the backend on EC2, which reads/writes data to the Neon database

---

## 2. What is AWS?

**Amazon Web Services (AWS)** is like renting computers, storage, and networking from Amazon instead of buying your own hardware.

Think of it this way:
- **Without AWS:** You buy a physical server, put it in a room, connect it to the internet, maintain it yourself
- **With AWS:** You click a few buttons (or run commands), and Amazon gives you a virtual server in their data center. They handle the electricity, cooling, physical security, and internet connection

**Why AWS?**
- No upfront hardware costs
- Scale up/down as needed
- Pay only for what you use
- Data centers worldwide (we chose **ap-south-1** = Mumbai, closest to Pune)

**Our AWS Account:**
- Account ID: `365885288238`
- Region: `ap-south-1` (Mumbai, India)

---

## 3. IAM — Who Gets Access

**IAM = Identity and Access Management**

Think of IAM like a security office that decides who can enter which rooms in a building.

### What We Created
- **IAM User:** `PCS_openclaw` — this is the "identity" I use to interact with AWS
- **Access Key ID:** `AKIAVKMDWN4XJ4VD5OO3` — like a username
- **Secret Access Key:** (hidden) — like a password

### Permissions We Attached
```
AmazonEC2FullAccess       → Can create/manage servers
AmazonS3FullAccess        → Can create/manage file storage
CloudFrontFullAccess      → Can manage CDN (content delivery)
AmazonSSMFullAccess       → Can manage secrets
IAMReadOnlyAccess         → Can view (but not change) user permissions
```

### Why Permissions Matter
Without proper permissions, the IAM user can't do anything. It's like giving someone a key card — the card only opens doors you've authorized. This prevents accidental (or malicious) access to resources you don't want touched.

### Best Practice
In production, you'd create **separate IAM users** with **minimal permissions** (principle of least privilege). For example, a deployment bot would only have permission to upload to S3 and restart EC2 — nothing else. We used broad permissions for setup speed; tighten them later.

---

## 4. VPC — Your Private Network

**VPC = Virtual Private Cloud**

### The Analogy
Imagine AWS is a massive apartment complex. A VPC is **your own apartment** within it — you have walls, your own rooms (subnets), your own front door (internet gateway), and your own mailbox (route table). Other tenants can't walk into your apartment.

### What We Created

#### VPC (The Apartment)
```
VPC ID: vpc-0170654f784a116fa
CIDR: 10.0.0.0/16
```
- **CIDR 10.0.0.0/16** means our private network has IP addresses from `10.0.0.0` to `10.0.255.255` — that's 65,536 addresses. Way more than we need, but it's standard.
- Everything inside this VPC is **isolated from the rest of AWS** by default.

#### Subnet (A Room in the Apartment)
```
Subnet ID: subnet-05caae9172aa2eb72
CIDR: 10.0.1.0/24
Availability Zone: ap-south-1a
```
- A **subnet** is a subdivision of your VPC. Think of it as a room.
- `10.0.1.0/24` = 256 IP addresses (10.0.1.0 to 10.0.1.255)
- **Public subnet** means resources here can have public IP addresses (accessible from the internet)
- **Availability Zone ap-south-1a** = a specific data center building within Mumbai. AWS has multiple buildings for redundancy.

#### Internet Gateway (The Front Door)
```
IGW ID: igw-038d513d0df16692b
```
- Without this, nothing in your VPC can reach the internet, and nobody from the internet can reach your servers.
- It's literally the bridge between your private network and the public internet.

#### Route Table (The Address Directory)
```
Route Table ID: rtb-0ac09137bbbd37c18
Rule: 0.0.0.0/0 → igw-038d513d0df16692b
```
- This tells AWS: "Any traffic going to the internet (0.0.0.0/0 = anywhere) should go through the Internet Gateway"
- Without this rule, your EC2 instance would be connected to the VPC but couldn't talk to the outside world

#### Security Group (The Bouncer)
```
Security Group ID: sg-0da18892863ce990a
```
- A **firewall** that controls what traffic can enter and leave your EC2 instance
- Think of it as a bouncer at a club — only lets in people on the guest list

**Our rules:**
| Direction | Port | Protocol | Source | Why |
|-----------|------|----------|--------|-----|
| Inbound | 22 | TCP | 0.0.0.0/0 | SSH access (remote login to server) |
| Inbound | 80 | TCP | 0.0.0.0/0 | HTTP web traffic |
| Inbound | 443 | TCP | 0.0.0.0/0 | HTTPS secure web traffic |
| Inbound | 3000-3002 | TCP | 0.0.0.0/0 | Our 3 backend API ports |
| Outbound | All | All | 0.0.0.0/0 | Server can reach anything (DB, npm, etc.) |

### Visual Summary
```
Internet
    │
    ▼
┌────────────────────── VPC (10.0.0.0/16) ──────────────────────┐
│                                                                │
│   Internet Gateway (igw-038d...)                               │
│       │                                                        │
│       ▼                                                        │
│   Route Table ──▶ Public Subnet (10.0.1.0/24)                 │
│                       │                                        │
│                   Security Group (firewall)                     │
│                       │                                        │
│                   EC2 Instance (43.204.37.17)                  │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## 5. EC2 — Your Server in the Cloud

**EC2 = Elastic Compute Cloud** (basically a virtual computer)

### What We Created
```
Instance ID:  i-02140b6fbb9abf976
Instance Type: t3.micro
Public IP:    43.204.37.17
OS:           Ubuntu 22.04 LTS
Storage:      20 GB (gp3 SSD)
SSH Key:      pcs-key.pem
```

### Instance Type Explained
**t3.micro** means:
- **t3** = "burstable" family. Like a car with a small engine that can temporarily boost speed. Good for workloads that aren't constantly heavy.
- **micro** = the size. Specifically:
  - **2 vCPUs** (virtual processors)
  - **1 GB RAM** (memory)
  - **Free tier eligible** for 12 months (750 hours/month free)

### Why t3.micro?
It's free for the first year and sufficient for a demo/early-stage product. When you get real users, you'd upgrade to t3.small (2 GB RAM) or t3.medium (4 GB RAM).

### Instance Type Comparison
| Type | vCPUs | RAM | Cost/month | Good For |
|------|-------|-----|------------|----------|
| t3.micro | 2 | 1 GB | Free (then ~$8) | Demo, small apps |
| t3.small | 2 | 2 GB | ~$16 | Small production |
| t3.medium | 2 | 4 GB | ~$32 | Medium production |
| t3.large | 2 | 8 GB | ~$64 | Heavy workloads |

### Storage: 20 GB gp3
- **gp3** = General Purpose SSD (fast, affordable)
- 20 GB holds the OS (~5 GB), Node.js, our app code, and logs
- This is the **EBS volume** (Elastic Block Store) — it's like the hard drive attached to your virtual computer
- **Important:** This storage **persists** through reboots and stop/start. It's only deleted if you **terminate** the instance (with delete-on-termination enabled).

### SSH Key Pair
```bash
# How to connect to your server:
ssh -i ~/.ssh/pcs-key.pem ubuntu@43.204.37.17
```
- **pcs-key.pem** is a private key file. It's like a physical key to your server.
- Only someone with this file can SSH into the server.
- **Never share this file.** It's stored at `~/.ssh/pcs-key.pem` on your local machine.

### What's Installed on the Server
| Software | Version | Purpose |
|----------|---------|---------|
| Ubuntu 22.04 | OS | Operating system |
| Node.js | v20.20.0 | Runs our NestJS backend |
| NPM | v10.8.2 | Package manager |
| PM2 | v6.0.14 | Process manager (keeps backend running) |
| Nginx | latest | Reverse proxy (future use with domains) |
| Git | latest | Code management |

---

## 6. S3 — File Storage & Website Hosting

**S3 = Simple Storage Service**

### The Analogy
S3 is like Google Drive or Dropbox, but for servers. You create **buckets** (folders) and put **objects** (files) in them.

### Why S3 for Frontend?
Your Angular frontend, after building, is just a bunch of static files (HTML, CSS, JavaScript). You don't need a server to "run" it — you just need somewhere to host the files so browsers can download them. S3 is perfect for this because:
- It's dirt cheap (~$0.023 per GB/month)
- It's incredibly fast and reliable (99.999999999% durability)
- It can serve files directly as a website
- No server to maintain

### Our 3 Buckets
| Bucket Name | Environment | URL |
|------------|-------------|-----|
| pcs-frontend-dev-primeterminal | Development | http://pcs-frontend-dev-primeterminal.s3-website.ap-south-1.amazonaws.com |
| pcs-frontend-stage-primeterminal | Staging | http://pcs-frontend-stage-primeterminal.s3-website.ap-south-1.amazonaws.com |
| pcs-frontend-prod-primeterminal | Production | http://pcs-frontend-prod-primeterminal.s3-website.ap-south-1.amazonaws.com |

### What's In Each Bucket
After running `ng build`, Angular produces files like:
```
index.html          → The main HTML page
main-J6MQTEIP.js    → Your Angular app code (compiled)
styles-4RZVYM4N.css → Your styles (compiled)
favicon.ico         → The browser tab icon
assets/             → Images, fonts, etc.
```
These files are uploaded to S3 using `aws s3 sync`.

### Bucket Configuration
For each bucket, we configured:

1. **Static Website Hosting:** Tells S3 to serve files as a website
   - Index document: `index.html` (what to show when someone visits the root URL)
   - Error document: `index.html` (important for Angular! When someone goes to `/dashboard`, S3 would normally say "file not found" because there's no `dashboard` file. By redirecting errors to `index.html`, Angular's router handles the URL.)

2. **Public Access:** By default, S3 buckets are private. We disabled the "block public access" setting so anyone on the internet can view the website.

3. **Bucket Policy:** A JSON rule that says "allow anyone to read files from this bucket":
   ```json
   {
     "Effect": "Allow",
     "Principal": "*",
     "Action": "s3:GetObject",
     "Resource": "arn:aws:s3:::bucket-name/*"
   }
   ```

### How the Frontend Knows Which Backend to Talk To
Each environment's frontend is built with a different **environment file**:

```typescript
// environment.dev.ts → Built into DEV frontend
export const environment = {
  production: false,
  apiUrl: 'http://43.204.37.17:3001/api'  // Dev backend
};

// environment.stage.ts → Built into STAGE frontend
export const environment = {
  production: false,
  apiUrl: 'http://43.204.37.17:3002/api'  // Stage backend
};

// environment.prod.ts → Built into PROD frontend
export const environment = {
  production: true,
  apiUrl: 'http://43.204.37.17:3000/api'  // Prod backend
};
```

Angular **bakes** the correct API URL into the JavaScript during the build process. So the dev frontend always talks to port 3001, stage to 3002, and prod to 3000.

---

## 7. SSM Parameter Store — Secrets Management

**SSM = Systems Manager**

### The Problem
Your app needs secrets: database passwords, JWT keys, API tokens. You **never** put these in your code (someone could find them on GitHub). So where do you store them?

### The Solution: Parameter Store
AWS SSM Parameter Store is a **secure vault** for configuration values. Think of it as a password manager for your servers.

### What We Stored
| Parameter Name | Type | Contains |
|---------------|------|----------|
| /pcs/dev/database-url | SecureString | Neon DB connection string for dev |
| /pcs/dev/jwt-secret | SecureString | JWT signing key for dev |
| /pcs/stage/database-url | SecureString | Neon DB connection string for stage |
| /pcs/stage/jwt-secret | SecureString | JWT signing key for stage |
| /pcs/prod/database-url | SecureString | Neon DB connection string for prod |
| /pcs/prod/jwt-secret | SecureString | JWT signing key for prod |

### SecureString
- Values are **encrypted** using AWS KMS (Key Management Service)
- Even if someone gains access to Parameter Store, they can't read the values without decryption permission
- When we retrieve them, we use `--with-decryption` flag

### How Secrets Get to the Server
Currently, we fetched secrets from SSM and wrote them to `.env` files on the EC2 instance during deployment. In a more advanced setup, the app would fetch secrets directly from SSM at startup (no files on disk).

---

## 8. PM2 — Keeping Your Backend Alive

**PM2 = Process Manager 2**

### The Problem
When you run `node dist/main.js`, it starts your backend. But:
- If the process crashes → your API goes down, nobody can use the app
- If you close your SSH session → the process dies
- If the server reboots → the process doesn't come back
- You can't run multiple instances easily

### The Solution: PM2
PM2 is a **process manager** for Node.js. It solves all of the above:

| Feature | What It Does |
|---------|-------------|
| **Auto-restart** | If your app crashes, PM2 restarts it immediately |
| **Background running** | PM2 runs as a daemon — closing SSH doesn't kill your app |
| **Boot startup** | PM2 restarts your apps automatically when the server reboots |
| **Logging** | Captures all console.log and errors to log files |
| **Monitoring** | Shows CPU/memory usage per app |
| **Multi-app** | Runs multiple apps simultaneously (our 3 environments!) |

### Our PM2 Setup
```
┌────────────────────────────────────────────────────────┐
│                    EC2 Instance                        │
│                                                        │
│   PM2 Process Manager                                  │
│   ├── pcs-dev    → /opt/pcs/dev/dist/main.js  :3001  │
│   ├── pcs-stage  → /opt/pcs/stage/dist/main.js :3002 │
│   └── pcs-prod   → /opt/pcs/prod/dist/main.js :3000  │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### Ecosystem Config
PM2 uses an **ecosystem file** to know what to run:
```javascript
// /opt/pcs/ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'pcs-dev',
      cwd: '/opt/pcs/dev',
      script: '/opt/pcs/dev/start.sh',    // Loads .env then runs node
      interpreter: '/bin/bash'
    },
    {
      name: 'pcs-stage',
      cwd: '/opt/pcs/stage',
      script: '/opt/pcs/stage/start.sh',
      interpreter: '/bin/bash'
    },
    {
      name: 'pcs-prod',
      cwd: '/opt/pcs/prod',
      script: '/opt/pcs/prod/start.sh',
      interpreter: '/bin/bash'
    }
  ]
};
```

### Each Environment's Start Script
```bash
#!/bin/bash
# /opt/pcs/prod/start.sh
set -a                        # Auto-export all variables
source /opt/pcs/prod/.env     # Load environment variables
set +a
exec node dist/main.js        # Start the backend
```

This approach keeps secrets in `.env` files (not in PM2 config) and loads them before starting the app.

### Useful PM2 Commands
```bash
# SSH into server first:
ssh -i ~/.ssh/pcs-key.pem ubuntu@43.204.37.17

# View status of all apps
pm2 status

# View logs (live, streaming)
pm2 logs                    # All apps
pm2 logs pcs-prod           # Only prod
pm2 logs pcs-dev --lines 50 # Last 50 lines of dev

# Restart apps
pm2 restart pcs-prod        # Restart one
pm2 restart all             # Restart all

# Stop/start
pm2 stop pcs-dev
pm2 start pcs-dev

# Monitor CPU/RAM in real-time
pm2 monit

# Save current process list (survives reboot)
pm2 save
```

---

## 9. Neon DB — Your Database

### What is Neon?
**Neon** is a cloud-hosted PostgreSQL database. Think of it as a PostgreSQL server that someone else manages for you — you just use it.

### Why Not Host PostgreSQL on EC2?
You could, but:
- You'd need to manage backups yourself
- It uses RAM on your t3.micro (only 1 GB!)
- If the EC2 instance dies, your data could be lost
- Neon has a nice **web console** to browse tables visually

### Our Setup
```
Connection String: postgresql://neondb_owner:***@ep-curly-pine-aivn3f9s-pooler.c-4.us-east-1.aws.neon.tech/neondb
```

Let's break this down:
```
postgresql://          → Protocol (like http:// but for PostgreSQL)
neondb_owner           → Username
:***                   → Password
@ep-curly-pine-...     → Server hostname (Neon's servers in US East)
/neondb                → Database name
?sslmode=require       → Use encrypted connection
```

### The "-pooler" Part
Notice the hostname has `-pooler` in it. This means we're using **connection pooling**:
- Without pooling: Each backend request opens a new database connection (slow, limited)
- With pooling: Neon maintains a pool of connections and shares them (fast, efficient)
- Essential for serverless/cloud databases

### Current Database Layout
All 3 environments (dev, stage, prod) currently share the **same database** (`neondb`). This is fine for development. When you need separate data:
- Create `pcs_dev` and `pcs_stage` databases on Neon
- Update the connection strings in the `.env` files

### Viewing Your Data
1. Go to https://console.neon.tech
2. Select your project
3. Click "Tables" in the sidebar
4. Browse all your tables: users, products, work_orders, time_entries, etc.

---

## 10. Dev / Stage / Prod — Why 3 Environments?

### The Real-World Problem
Imagine you're working on a new feature. You write code, deploy it directly to the live website, and... it has a bug. Now every user sees the broken page. 😱

### The Solution: Multiple Environments

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│   DEV    │ ──▶ │  STAGE   │ ──▶ │   PROD   │
│          │     │          │     │          │
│ For      │     │ For      │     │ For      │
│ building │     │ testing  │     │ real     │
│ features │     │ & QA     │     │ users    │
└──────────┘     └──────────┘     └──────────┘
   Messy,           Stable,          Rock
   breaking         tested           solid
   things OK        features         only
```

| Environment | Purpose | Who Uses It | Stability |
|------------|---------|-------------|-----------|
| **DEV** | Active development, trying new things | Developers only | Can break |
| **STAGE** | Testing before production, client demos | QA team, stakeholders | Should be stable |
| **PROD** | Live product, real users | Everyone | Must be rock solid |

### How They're Separated in Our Setup

**Backend (EC2):**
Each environment runs as a separate Node.js process on different ports:
```
/opt/pcs/dev/    → Port 3001  (own .env with dev secrets)
/opt/pcs/stage/  → Port 3002  (own .env with stage secrets)
/opt/pcs/prod/   → Port 3000  (own .env with prod secrets)
```

**Frontend (S3):**
Each environment is a separate S3 bucket with its own build:
```
pcs-frontend-dev-primeterminal    → Built with apiUrl pointing to :3001
pcs-frontend-stage-primeterminal  → Built with apiUrl pointing to :3002
pcs-frontend-prod-primeterminal   → Built with apiUrl pointing to :3000
```

**Database:**
Currently shared (all point to `neondb`). In the future:
```
Dev   → pcs_dev database
Stage → pcs_stage database
Prod  → neondb (production database)
```

**Secrets (SSM):**
Each environment has its own set of secrets:
```
/pcs/dev/database-url     /pcs/dev/jwt-secret
/pcs/stage/database-url   /pcs/stage/jwt-secret
/pcs/prod/database-url    /pcs/prod/jwt-secret
```

### The Deployment Flow
```
1. Developer writes code locally
2. Build for DEV → Deploy to dev S3 + update dev backend
3. Test on DEV environment
4. If good → Build for STAGE → Deploy to stage
5. QA/client tests on STAGE
6. If approved → Build for PROD → Deploy to prod
7. Real users see the update
```

---

## 11. How Everything Connects

### Request Flow: User Opens the App

```
Step 1: User types the prod URL in their browser
        http://pcs-frontend-prod-primeterminal.s3-website.ap-south-1.amazonaws.com

Step 2: Browser sends request to S3
        S3 returns index.html + JavaScript + CSS files

Step 3: Browser loads Angular app
        Angular app starts, shows login page

Step 4: User enters email/password, clicks Login
        Angular sends POST request to:
        http://43.204.37.17:3000/api/auth/login
        with body: { email: "admin@pcs.local", password: "password123" }

Step 5: Request hits EC2 Security Group
        Port 3000 is allowed ✅ → traffic passes through

Step 6: Request reaches PM2 → pcs-prod process
        NestJS handles the /api/auth/login route
        AuthService validates credentials against Neon DB

Step 7: Backend queries Neon PostgreSQL
        SELECT * FROM users WHERE email = 'admin@pcs.local'
        Validates password hash
        Creates JWT token

Step 8: Backend sends response back
        { data: { accessToken: "eyJhb...", user: { ... } } }

Step 9: Angular receives token, stores it
        Redirects to /dashboard
        All subsequent API calls include the token in headers:
        Authorization: Bearer eyJhb...
```

### Network Diagram
```
┌─────────────────────────────────────────────────────────────┐
│                     Internet                                 │
│                                                             │
│  ┌──────────┐                    ┌──────────────────────┐   │
│  │ Browser  │──── GET files ────▶│  S3 (ap-south-1)     │   │
│  │          │◀── HTML/JS/CSS ────│  Static Website       │   │
│  │          │                    └──────────────────────┘   │
│  │          │                                               │
│  │          │── API calls ──┐                               │
│  └──────────┘               │                               │
│                              ▼                               │
│            ┌──── VPC (10.0.0.0/16) ────────────────┐        │
│            │                                       │        │
│            │  Internet Gateway                     │        │
│            │       │                               │        │
│            │  Security Group (ports 3000-3002)     │        │
│            │       │                               │        │
│            │  ┌────▼─────────────────────────┐     │        │
│            │  │  EC2 (43.204.37.17)          │     │        │
│            │  │                              │     │        │
│            │  │  PM2                         │     │        │
│            │  │  ├─ pcs-dev   :3001 ─────┐   │     │        │
│            │  │  ├─ pcs-stage :3002 ──┐  │   │     │        │
│            │  │  └─ pcs-prod  :3000 ┐ │  │   │     │        │
│            │  └─────────────────────┼─┼──┼───┘     │        │
│            │                        │ │  │         │        │
│            └────────────────────────┼─┼──┼─────────┘        │
│                                     │ │  │                   │
│                                     ▼ ▼  ▼                   │
│                          ┌──────────────────────┐            │
│                          │  Neon PostgreSQL      │            │
│                          │  (US East)            │            │
│                          │  Database: neondb     │            │
│                          └──────────────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

---

## 12. How Code Gets to AWS

### Current Approach: Manual Deployment
Right now, we deploy manually from your local machine:

#### Backend Deployment
```bash
# 1. Build the backend locally
cd /home/vboxuser/pcs-platform/backend
npm run build                    # Compiles TypeScript → JavaScript in dist/

# 2. Package the build
tar czf /tmp/pcs-backend.tar.gz dist/ package.json package-lock.json

# 3. Upload to EC2 via SSH
scp -i ~/.ssh/pcs-key.pem /tmp/pcs-backend.tar.gz ubuntu@43.204.37.17:/tmp/

# 4. SSH into server and deploy
ssh -i ~/.ssh/pcs-key.pem ubuntu@43.204.37.17
cd /opt/pcs/prod
tar xzf /tmp/pcs-backend.tar.gz  # Extract new code
npm install --production          # Install dependencies
pm2 restart pcs-prod             # Restart the app
```

#### Frontend Deployment
```bash
# 1. Build the frontend with the right environment
cd /home/vboxuser/pcs-platform/frontend
npx ng build --configuration=production  # Builds with prod API URL baked in

# 2. Upload to S3
aws s3 sync dist/frontend/browser/ s3://pcs-frontend-prod-primeterminal/ --delete
# --delete removes old files that no longer exist in the new build
```

### Does EC2 Fetch Code from GitHub?
**Not currently.** The code goes:
```
Your local machine → (SCP/S3 sync) → AWS
```

### Future: CI/CD Pipeline (Automated Deployment)
In a professional setup, you'd use **GitHub Actions** to automate this:
```
Developer pushes code to GitHub
        │
        ▼
GitHub Actions automatically:
  1. Runs tests
  2. Builds the app
  3. Deploys to the correct environment
        │
        ▼
App is live — no manual steps!
```

This is called **CI/CD** (Continuous Integration / Continuous Deployment). We can set this up as a next step.

---

## 13. Security — What Protects What

### Layers of Security

```
Layer 1: IAM
├── Only authorized users can manage AWS resources
├── Access keys can be rotated/revoked
└── Permissions can be restricted per service

Layer 2: VPC + Security Group
├── Only allowed ports are open (22, 80, 443, 3000-3002)
├── Server is in a private network
└── Unwanted traffic is blocked at the firewall

Layer 3: SSH Key
├── Only someone with pcs-key.pem can log into the server
└── Password auth is disabled by default on Ubuntu EC2

Layer 4: Application
├── JWT tokens for API authentication
├── Role-based access (admin, manager, supervisor, operator)
├── Password hashing (bcrypt)
└── CORS restricts which frontends can call the API

Layer 5: Secrets
├── Database passwords in SSM (encrypted)
├── .env files have 600 permissions (only owner can read)
└── Nothing sensitive in the codebase
```

### What Could Be Improved
| Current | Better | Best |
|---------|--------|------|
| SSH open to 0.0.0.0/0 | Restrict to your IP only | Use AWS Session Manager (no SSH) |
| HTTP (no SSL) | Add SSL certificate | CloudFront + ACM (free SSL) |
| API ports exposed directly | Nginx reverse proxy | Load balancer + private subnet |
| Manual .env files | Fetch from SSM at runtime | Use AWS Secrets Manager |

---

## 14. Common Tasks & Commands

### SSH Into the Server
```bash
ssh -i ~/.ssh/pcs-key.pem ubuntu@43.204.37.17
```

### Check if Everything is Running
```bash
# On the server:
pm2 status                    # Should show 3 apps "online"
pm2 logs --lines 20           # Recent logs
```

### Deploy a Backend Update
```bash
# On your local machine:
cd /home/vboxuser/pcs-platform/backend
npm run build
tar czf /tmp/pcs-backend.tar.gz dist/ package.json package-lock.json
scp -i ~/.ssh/pcs-key.pem /tmp/pcs-backend.tar.gz ubuntu@43.204.37.17:/tmp/

# On the server (for prod):
cd /opt/pcs/prod
tar xzf /tmp/pcs-backend.tar.gz
npm install --production
pm2 restart pcs-prod
```

### Deploy a Frontend Update
```bash
# On your local machine:
cd /home/vboxuser/pcs-platform/frontend

# For dev:
npx ng build --configuration=dev
aws s3 sync dist/frontend/browser/ s3://pcs-frontend-dev-primeterminal/ --delete

# For stage:
npx ng build --configuration=stage
aws s3 sync dist/frontend/browser/ s3://pcs-frontend-stage-primeterminal/ --delete

# For prod:
npx ng build --configuration=production
aws s3 sync dist/frontend/browser/ s3://pcs-frontend-prod-primeterminal/ --delete
```

### View Logs for a Specific Environment
```bash
# On the server:
pm2 logs pcs-prod --lines 100
pm2 logs pcs-dev --lines 100
pm2 logs pcs-stage --lines 100
```

### Restart All Backends
```bash
# On the server:
pm2 restart all
```

### Check Server Resources
```bash
# On the server:
htop                 # CPU and memory usage
df -h                # Disk space
pm2 monit            # PM2's built-in monitor
```

---

## 15. Cost Breakdown

### Current Monthly Cost: ~$0

| Service | Free Tier | After Free Tier |
|---------|-----------|-----------------|
| EC2 t3.micro | 750 hrs/month for 12 months | ~$8/month |
| S3 (3 buckets) | 5 GB free | ~$0.50/month |
| Data Transfer | 100 GB/month free | ~$0.09/GB |
| SSM Parameter Store | Free (standard tier) | Free |
| Neon DB | 0.5 GB free forever | ~$19/month |

**Year 1:** Essentially **$0/month** (everything within free tier)
**Year 2+:** ~$28/month (EC2 + S3 + Neon)

### How to Monitor Costs
1. Go to AWS Console → **Billing & Cost Management**
2. Set up a **budget alert** (e.g., alert me if spending exceeds $10/month)
3. Check the **Free Tier Usage** dashboard regularly

---

## 16. Glossary

| Term | Plain English |
|------|-------------|
| **AMI** | Amazon Machine Image — a template/snapshot to create EC2 instances. We used Ubuntu 22.04 AMI. |
| **Availability Zone** | A physical data center building. ap-south-1a is one building in Mumbai. |
| **CIDR** | IP address range notation. 10.0.0.0/16 means "all IPs starting with 10.0" |
| **CloudFront** | AWS CDN — caches your files at locations worldwide for faster loading (not set up yet) |
| **CORS** | Cross-Origin Resource Sharing — browser security that controls which websites can call your API |
| **EBS** | Elastic Block Store — the "hard drive" attached to your EC2 instance |
| **gp3** | A type of EBS volume (General Purpose SSD v3) — good balance of speed and cost |
| **IAM** | Identity and Access Management — AWS's permission system |
| **JWT** | JSON Web Token — a signed token that proves a user is logged in |
| **Nginx** | A web server/reverse proxy — installed for future use with custom domains |
| **PM2** | Process Manager for Node.js — keeps your backend running 24/7 |
| **Region** | A geographic area with multiple data centers. ap-south-1 = Mumbai |
| **S3** | Simple Storage Service — file/object storage, also used for static website hosting |
| **Security Group** | A virtual firewall controlling traffic to/from EC2 instances |
| **SSD** | Solid State Drive — fast storage (no moving parts, unlike old hard drives) |
| **SSH** | Secure Shell — encrypted remote login to servers |
| **SSL/TLS** | Encryption for HTTPS — makes the connection secure (lock icon in browser) |
| **SSM** | Systems Manager — AWS service that includes Parameter Store for secrets |
| **Subnet** | A subdivision of a VPC's IP range. Like rooms in an apartment. |
| **VPC** | Virtual Private Cloud — your isolated private network within AWS |

---

## Quick Reference Card

```
╔═══════════════════════════════════════════════════════════╗
║                    PCS PLATFORM                           ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  FRONTEND URLS:                                           ║
║  DEV:   ...dev-primeterminal.s3-website.ap-south-1...    ║
║  STAGE: ...stage-primeterminal.s3-website.ap-south-1...  ║
║  PROD:  ...prod-primeterminal.s3-website.ap-south-1...   ║
║                                                           ║
║  BACKEND URLS:                                            ║
║  DEV:   http://43.204.37.17:3001                         ║
║  STAGE: http://43.204.37.17:3002                         ║
║  PROD:  http://43.204.37.17:3000                         ║
║                                                           ║
║  SWAGGER DOCS:                                            ║
║  http://43.204.37.17:{3000|3001|3002}/api/docs           ║
║                                                           ║
║  SSH:                                                     ║
║  ssh -i ~/.ssh/pcs-key.pem ubuntu@43.204.37.17           ║
║                                                           ║
║  LOGIN:                                                   ║
║  admin@pcs.local / password123                            ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
```

---

*Document created: February 22, 2026*
*Last updated: February 22, 2026*
*Author: OpenClaw AI Assistant for Spade Bloom*
