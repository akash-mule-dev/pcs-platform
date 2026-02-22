# PCS Platform — Infrastructure Reference

> Complete reference of all AWS resources, DNS configuration, and deployment details.

---

## Table of Contents
1. [AWS Account](#aws-account)
2. [VPC & Networking](#vpc--networking)
3. [EC2 Instance](#ec2-instance)
4. [S3 Buckets](#s3-buckets)
5. [CloudFront Distributions](#cloudfront-distributions)
6. [SSL Certificate](#ssl-certificate)
7. [SSM Parameter Store (Secrets)](#ssm-parameter-store-secrets)
8. [PM2 Process Manager](#pm2-process-manager)
9. [Nginx Reverse Proxy](#nginx-reverse-proxy)
10. [Neon Database](#neon-database)
11. [GoDaddy DNS Configuration](#godaddy-dns-configuration)
12. [Environment URLs](#environment-urls)
13. [Login Credentials](#login-credentials)

---

## AWS Account

| Field | Value |
|-------|-------|
| Account ID | `365885288238` |
| Region | `ap-south-1` (Mumbai, India) |
| IAM User | `PCS_openclaw` |
| Access Key ID | `AKIAVKMDWN4XJ4VD5OO3` |

### IAM Policies Attached
- `AmazonEC2FullAccess`
- `AmazonS3FullAccess`
- `CloudFrontFullAccess`
- `AmazonSSMFullAccess`
- `IAMReadOnlyAccess`
- `AWSCertificateManagerFullAccess`

---

## VPC & Networking

| Resource | ID | Details |
|----------|----|---------|
| VPC | `vpc-0170654f784a116fa` | CIDR: `10.0.0.0/16`, DNS enabled |
| Internet Gateway | `igw-038d513d0df16692b` | Attached to VPC |
| Public Subnet | `subnet-05caae9172aa2eb72` | CIDR: `10.0.1.0/24`, AZ: `ap-south-1a`, auto-assign public IP |
| Route Table | `rtb-0ac09137bbbd37c18` | `0.0.0.0/0` → Internet Gateway |
| Security Group | `sg-0da18892863ce990a` | Name: `pcs-backend-sg` |

### Security Group Inbound Rules
| Port | Protocol | Source | Purpose |
|------|----------|--------|---------|
| 22 | TCP | 0.0.0.0/0 | SSH access |
| 80 | TCP | 0.0.0.0/0 | HTTP (Nginx) |
| 443 | TCP | 0.0.0.0/0 | HTTPS |
| 3000-3002 | TCP | 0.0.0.0/0 | Backend API ports (prod/dev/stage) |

---

## EC2 Instance

| Field | Value |
|-------|-------|
| Instance ID | `i-02140b6fbb9abf976` |
| Instance Type | `t3.micro` (2 vCPU, 1 GB RAM) — Free tier |
| Public IP | `43.204.37.17` |
| OS | Ubuntu 22.04 LTS (Jammy) |
| AMI | `ami-07216ac99dc46a187` |
| Storage | 20 GB gp3 SSD |
| SSH Key | `pcs-key` (`~/.ssh/pcs-key.pem` on local machine) |
| Availability Zone | `ap-south-1a` |

### SSH Access
```bash
ssh -i ~/.ssh/pcs-key.pem ubuntu@43.204.37.17
```

### Installed Software
| Software | Version | Purpose |
|----------|---------|---------|
| Node.js | v20.20.0 | Runtime for NestJS backend |
| NPM | v10.8.2 | Package manager |
| PM2 | v6.0.14 | Process manager (auto-restart, logging) |
| Nginx | latest | Reverse proxy for subdomains |
| Git | latest | Version control |

### Directory Structure on EC2
```
/opt/pcs/
├── dev/                  # Dev environment
│   ├── dist/             # Compiled NestJS app
│   ├── node_modules/     # Dependencies
│   ├── .env              # Dev environment variables
│   └── start.sh          # PM2 startup script
├── stage/                # Stage environment
│   ├── dist/
│   ├── node_modules/
│   ├── .env
│   └── start.sh
├── prod/                 # Production environment
│   ├── dist/
│   ├── node_modules/
│   ├── .env
│   └── start.sh
└── ecosystem.config.js   # PM2 configuration
```

---

## S3 Buckets

Three S3 buckets host the Angular frontend for each environment.

| Bucket Name | Environment | Direct URL |
|------------|-------------|------------|
| `pcs-frontend-dev-primeterminal` | Development | http://pcs-frontend-dev-primeterminal.s3-website.ap-south-1.amazonaws.com |
| `pcs-frontend-stage-primeterminal` | Staging | http://pcs-frontend-stage-primeterminal.s3-website.ap-south-1.amazonaws.com |
| `pcs-frontend-prod-primeterminal` | Production | http://pcs-frontend-prod-primeterminal.s3-website.ap-south-1.amazonaws.com |

### Bucket Configuration (all 3)
- **Static Website Hosting:** Enabled
- **Index Document:** `index.html`
- **Error Document:** `index.html` (for Angular SPA routing)
- **Public Access:** Enabled (block public access disabled)
- **Bucket Policy:** Public read (`s3:GetObject` for `*`)

### Deploying to S3
```bash
# Build frontend with environment-specific config
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

---

## CloudFront Distributions

CloudFront provides HTTPS (SSL) and CDN caching for the frontend.

### Main Website (Landing Page)
| Field | Value |
|-------|-------|
| Distribution ID | `EHT114VO9BG9B` |
| Domain | `d2pv0ycsr3grbi.cloudfront.net` |
| Aliases | `primeterminaltech.com`, `www.primeterminaltech.com` |
| Origin | `akash-mule-dev.github.io/pcs-website` (GitHub Pages) |
| SSL | ✅ ACM certificate |
| Protocol | HTTPS (redirect HTTP → HTTPS) |
| Price Class | PriceClass_200 (NA, EU, Asia) |

### PCS App (Production Frontend)
| Field | Value |
|-------|-------|
| Distribution ID | `E25I57FKXNYW46` |
| Domain | `d387267ab216kr.cloudfront.net` |
| Aliases | `app.primeterminaltech.com` |
| Origin | `pcs-frontend-prod-primeterminal.s3-website.ap-south-1.amazonaws.com` |
| SSL | ✅ ACM certificate |
| Protocol | HTTPS (redirect HTTP → HTTPS) |
| Custom Error | 404 → `/index.html` (200) for Angular SPA routing |
| Price Class | PriceClass_200 |

### Invalidating CloudFront Cache
After deploying new frontend code, invalidate the cache:
```bash
# Main site
aws cloudfront create-invalidation --distribution-id EHT114VO9BG9B --paths "/*"

# App
aws cloudfront create-invalidation --distribution-id E25I57FKXNYW46 --paths "/*"
```

---

## SSL Certificate

| Field | Value |
|-------|-------|
| ARN | `arn:aws:acm:us-east-1:365885288238:certificate/886aa711-699d-4e98-aca2-0e379b0bace2` |
| Region | `us-east-1` (required for CloudFront) |
| Domains | `primeterminaltech.com`, `*.primeterminaltech.com` (wildcard) |
| Validation | DNS (CNAME record in GoDaddy) |
| Status | ISSUED ✅ |
| Auto-Renewal | Yes (AWS auto-renews DNS-validated certificates) |

### Validation CNAME Record
| Name | Value |
|------|-------|
| `_fd561ddaaefe1ba0ccfe78875232245f.primeterminaltech.com` | `_fb50f18beaef6913de373162866976e7.jkddzztszm.acm-validations.aws.` |

> ⚠️ Do NOT delete this CNAME — it's needed for certificate auto-renewal.

---

## SSM Parameter Store (Secrets)

All sensitive configuration is stored in AWS Systems Manager Parameter Store. **Never in the codebase.**

| Parameter | Type | Environment |
|-----------|------|-------------|
| `/pcs/dev/database-url` | SecureString | Dev DB connection string |
| `/pcs/dev/jwt-secret` | SecureString | Dev JWT signing key |
| `/pcs/stage/database-url` | SecureString | Stage DB connection string |
| `/pcs/stage/jwt-secret` | SecureString | Stage JWT signing key |
| `/pcs/prod/database-url` | SecureString | Prod DB connection string |
| `/pcs/prod/jwt-secret` | SecureString | Prod JWT signing key |

### Retrieving Secrets
```bash
# View a secret
aws ssm get-parameter --name "/pcs/prod/database-url" --with-decryption --query 'Parameter.Value' --output text

# Update a secret
aws ssm put-parameter --name "/pcs/prod/jwt-secret" --type SecureString --value "new-secret-value" --overwrite
```

### How Secrets Reach the App
1. During deployment, secrets are fetched from SSM
2. Written to `.env` files on EC2 (permission 600 — owner-only read)
3. PM2 start scripts source the `.env` file before launching Node.js
4. The `.env` files are NOT in the codebase or git

---

## PM2 Process Manager

PM2 runs three backend instances — one per environment.

### Process Status
```bash
ssh -i ~/.ssh/pcs-key.pem ubuntu@43.204.37.17 'pm2 status'
```

| PM2 Name | Port | Environment | CWD |
|----------|------|-------------|-----|
| `pcs-dev` | 3001 | Development | `/opt/pcs/dev` |
| `pcs-stage` | 3002 | Staging | `/opt/pcs/stage` |
| `pcs-prod` | 3000 | Production | `/opt/pcs/prod` |

### Ecosystem Config
Location: `/opt/pcs/ecosystem.config.js`

Each app uses a `start.sh` script that:
1. Sources the `.env` file (loads DATABASE_URL, JWT_SECRET, etc.)
2. Starts `node dist/main.js`

### PM2 Auto-Start
PM2 is configured to start on boot via systemd:
- Service: `pm2-ubuntu`
- Saved process list: `~/.pm2/dump.pm2`

### Common PM2 Commands
```bash
pm2 status                    # View all processes
pm2 logs pcs-prod             # View prod logs
pm2 logs pcs-prod --lines 100 # Last 100 lines
pm2 restart pcs-prod          # Restart prod
pm2 restart all               # Restart everything
pm2 monit                     # Real-time CPU/RAM monitor
pm2 save                      # Save process list for reboot
```

---

## Nginx Reverse Proxy

Nginx runs on the EC2 instance, routing subdomain traffic to the correct service.

### Config File
Location: `/etc/nginx/sites-available/pcs`

| Server Name | Proxies To |
|-------------|-----------|
| `api.primeterminaltech.com` | `http://127.0.0.1:3000` (Prod backend) |
| `dev.primeterminaltech.com` | S3 dev bucket (HTTP proxy) |
| `stage.primeterminaltech.com` | S3 stage bucket (HTTP proxy) |

### Why Nginx?
- **api subdomain:** Users access `api.primeterminaltech.com` (port 80) instead of `43.204.37.17:3000`. Nginx forwards to the backend on port 3000.
- **dev/stage subdomains:** Nginx proxies to S3 bucket URLs so users get clean subdomain URLs.
- **Future:** Nginx will handle SSL termination with Let's Encrypt for these subdomains.

### Nginx Commands
```bash
sudo nginx -t                  # Test config
sudo systemctl reload nginx    # Apply changes
sudo systemctl status nginx    # Check status
cat /etc/nginx/sites-available/pcs  # View config
```

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

### Additional Databases Created
| Database | Purpose | Status |
|----------|---------|--------|
| `neondb` | Production (and currently shared with dev/stage) | Active ✅ |
| `pcs_dev` | Future dedicated dev database | Created, unused |
| `pcs_stage` | Future dedicated stage database | Created, unused |

### Viewing Data
1. Go to https://console.neon.tech
2. Select your project
3. Click **Tables** → Browse all tables visually

### Seed Data Included
- 9 users (admin, manager, supervisors, operators)
- 3 products (PCB-X100, MOT-200, SEN-50)
- 3 processes with 21 stages
- 3 production lines with 15 stations
- 5+ work orders
- 50+ time tracking entries

---

## GoDaddy DNS Configuration

**Domain:** `primeterminaltech.com`
**Registrar:** GoDaddy
**DNS Management:** https://dcc.godaddy.com/manage/primeterminaltech.com/dns
**Nameservers:** `ns33.domaincontrol.com`, `ns34.domaincontrol.com`

### DNS Records

| Type | Name | Value | Purpose |
|------|------|-------|---------|
| **CNAME** | `_fd561ddaa...` | `_fb50f18bea...acm-validations.aws.` | SSL certificate validation (DO NOT DELETE) |
| **CNAME** | `www` | `d2pv0ycsr3grbi.cloudfront.net` | Landing page via CloudFront |
| **CNAME** | `app` | `d387267ab216kr.cloudfront.net` | PCS app via CloudFront |
| **A** | `api` | `43.204.37.17` | Backend API via EC2 |
| **A** | `dev` | `43.204.37.17` | Dev frontend via EC2/Nginx |
| **A** | `stage` | `43.204.37.17` | Stage frontend via EC2/Nginx |
| **Forward** | `@` (root) | `https://www.primeterminaltech.com` | Root domain redirect |

### How DNS Routes Traffic
```
User → www.primeterminaltech.com
       │
       ▼ (CNAME)
       d2pv0ycsr3grbi.cloudfront.net (CloudFront CDN)
       │
       ▼ (Origin)
       akash-mule-dev.github.io/pcs-website (GitHub Pages)


User → app.primeterminaltech.com
       │
       ▼ (CNAME)
       d387267ab216kr.cloudfront.net (CloudFront CDN)
       │
       ▼ (Origin)
       pcs-frontend-prod-primeterminal.s3-website... (S3 Bucket)


User → api.primeterminaltech.com
       │
       ▼ (A record)
       43.204.37.17 (EC2 Instance)
       │
       ▼ (Nginx proxy)
       localhost:3000 (PM2 pcs-prod process)


User → dev.primeterminaltech.com
       │
       ▼ (A record)
       43.204.37.17 (EC2 Instance)
       │
       ▼ (Nginx proxy)
       S3 dev bucket
```

---

## Environment URLs

### Production
| Service | URL |
|---------|-----|
| Landing Page | https://www.primeterminaltech.com |
| PCS App | https://app.primeterminaltech.com |
| Backend API | http://api.primeterminaltech.com |
| Swagger Docs | http://api.primeterminaltech.com/api/docs |
| GitHub Pages (direct) | https://akash-mule-dev.github.io/pcs-website |

### Development
| Service | URL |
|---------|-----|
| Frontend | http://dev.primeterminaltech.com |
| Backend API | http://43.204.37.17:3001 |
| Swagger Docs | http://43.204.37.17:3001/api/docs |
| S3 Direct | http://pcs-frontend-dev-primeterminal.s3-website.ap-south-1.amazonaws.com |

### Staging
| Service | URL |
|---------|-----|
| Frontend | http://stage.primeterminaltech.com |
| Backend API | http://43.204.37.17:3002 |
| Swagger Docs | http://43.204.37.17:3002/api/docs |
| S3 Direct | http://pcs-frontend-stage-primeterminal.s3-website.ap-south-1.amazonaws.com |

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
*Last updated: February 22, 2026*
