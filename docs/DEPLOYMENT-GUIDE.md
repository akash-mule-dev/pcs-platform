# PCS Platform — Deployment Guide

> Step-by-step instructions for deploying code changes to all 3 environments.

---

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Backend Deployment](#backend-deployment)
3. [Frontend Deployment](#frontend-deployment)
4. [Mobile App Build](#mobile-app-build)
5. [Database Operations](#database-operations)
6. [Rollback Procedures](#rollback-procedures)
7. [Monitoring & Logs](#monitoring--logs)

---

## Prerequisites

### Local Machine Requirements
```bash
# AWS CLI configured
aws sts get-caller-identity   # Should show PCS_openclaw

# SSH key available
ls ~/.ssh/pcs-key.pem

# Node.js and Angular CLI
node -v    # v20+
ng version # Angular 17+
```

### Server Access
```bash
ssh -i ~/.ssh/pcs-key.pem ubuntu@43.204.37.17
```

---

## Backend Deployment

### Step 1: Build Locally
```bash
cd /home/vboxuser/pcs-platform/backend
npm run build
```
This compiles TypeScript to JavaScript in the `dist/` folder.

### Step 2: Package
```bash
tar czf /tmp/pcs-backend.tar.gz dist/ package.json package-lock.json
```

### Step 3: Upload to EC2
```bash
scp -i ~/.ssh/pcs-key.pem /tmp/pcs-backend.tar.gz ubuntu@43.204.37.17:/tmp/
```

### Step 4: Deploy to Specific Environment

#### Deploy to DEV
```bash
ssh -i ~/.ssh/pcs-key.pem ubuntu@43.204.37.17 << 'EOF'
cd /opt/pcs/dev
tar xzf /tmp/pcs-backend.tar.gz
npm install --production
pm2 restart pcs-dev
echo "✅ Dev backend deployed"
EOF
```

#### Deploy to STAGE
```bash
ssh -i ~/.ssh/pcs-key.pem ubuntu@43.204.37.17 << 'EOF'
cd /opt/pcs/stage
tar xzf /tmp/pcs-backend.tar.gz
npm install --production
pm2 restart pcs-stage
echo "✅ Stage backend deployed"
EOF
```

#### Deploy to PROD
```bash
ssh -i ~/.ssh/pcs-key.pem ubuntu@43.204.37.17 << 'EOF'
cd /opt/pcs/prod
tar xzf /tmp/pcs-backend.tar.gz
npm install --production
pm2 restart pcs-prod
echo "✅ Prod backend deployed"
EOF
```

### Step 5: Verify
```bash
# Test login endpoint
curl -s http://api.primeterminaltech.com/api/auth/login \
  -X POST -H "Content-Type: application/json" \
  -d '{"email":"admin@pcs.local","password":"password123"}'
```

---

## Frontend Deployment

### Step 1: Build for Target Environment
```bash
cd /home/vboxuser/pcs-platform/frontend

# Stamp build info (commit hash + timestamp shown in sidebar)
node stamp-build.js

# DEV build (apiUrl → demo-api.spadebloom.com)
npx ng build --configuration=dev

# STAGE build (apiUrl → 43.204.37.17:3002)
npx ng build --configuration=stage

# PROD build (apiUrl → 43.204.37.17:3000)
npx ng build --configuration=production
```

### Step 2: Verify S3 Static Website Hosting
Before the first deploy, confirm each bucket has **Error document** set to `index.html`:
```bash
# Verify via AWS CLI (check WebsiteConfiguration has ErrorDocument → index.html)
aws s3api get-bucket-website --bucket pcs-frontend-dev-primeterminal
aws s3api get-bucket-website --bucket pcs-frontend-stage-primeterminal
aws s3api get-bucket-website --bucket pcs-frontend-prod-primeterminal

# If missing, set it:
aws s3 website s3://pcs-frontend-dev-primeterminal/ --index-document index.html --error-document index.html
```
> **Why:** Angular is an SPA — all routes like `/dashboard` and `/products` must serve `index.html`. Without the error document, direct URL navigation returns a 404.

### Step 3: Upload to S3
```bash
# DEV
aws s3 sync dist/frontend/browser/ s3://pcs-frontend-dev-primeterminal/ --delete

# STAGE
aws s3 sync dist/frontend/browser/ s3://pcs-frontend-stage-primeterminal/ --delete

# PROD
aws s3 sync dist/frontend/browser/ s3://pcs-frontend-prod-primeterminal/ --delete
```

### Step 3: Invalidate CloudFront Cache (Prod Only)
```bash
# App distribution (app.primeterminaltech.com)
aws cloudfront create-invalidation --distribution-id E25I57FKXNYW46 --paths "/*"
```
CloudFront caches files. Without invalidation, users may see old content for up to 24 hours.

### Step 4: Verify
Open the URL in browser:
- DEV: http://dev.primeterminaltech.com
- STAGE: http://stage.primeterminaltech.com
- PROD: https://app.primeterminaltech.com

---

## Mobile App Build

### Android (Debug APK)
```bash
cd /home/vboxuser/pcs-platform/mobile

# 1. Build web assets
npx ng build --configuration=production

# 2. Sync to Android
npx cap sync android

# 3. Build APK
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export ANDROID_HOME=$HOME/android-sdk
cd android && ./gradlew assembleDebug

# APK at: android/app/build/outputs/apk/debug/app-debug.apk
```

### Android (Release APK)
See `docs/MOBILE-BUILD-GUIDE.md` for signing instructions.

### iOS
Requires macOS + Xcode. See `docs/MOBILE-BUILD-GUIDE.md`.

---

## Database Operations

### Run Seed Data
```bash
ssh -i ~/.ssh/pcs-key.pem ubuntu@43.204.37.17 << 'EOF'
cd /opt/pcs/prod
export $(cat .env | xargs)
node -e "
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module.js');
const { SeedService } = require('./dist/seed/seed.service.js');
(async()=>{
  const app = await NestFactory.createApplicationContext(AppModule);
  await app.get(SeedService).seed();
  await app.close();
  console.log('Seeded');
})();
"
EOF
```

### Connect to Database Directly
```bash
# From local machine (needs psql installed)
psql 'postgresql://neondb_owner:<password>@ep-curly-pine-aivn3f9s-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require'
```

### View Data in Browser
Go to https://console.neon.tech → Your Project → Tables

---

## Rollback Procedures

### Backend Rollback
PM2 doesn't keep old versions. To rollback:
1. Checkout the previous git commit locally
2. Rebuild and redeploy (follow Backend Deployment steps)

```bash
cd /home/vboxuser/pcs-platform
git log --oneline -5          # Find the commit to rollback to
git checkout <commit-hash> -- backend/
cd backend && npm run build
# Then follow deployment steps
```

### Frontend Rollback
S3 versioning is not enabled. To rollback:
1. Checkout previous git commit
2. Rebuild and re-upload to S3

### Database Rollback
Neon provides **point-in-time recovery**:
1. Go to Neon Console → Your Project → Branches
2. Create a new branch from a past timestamp
3. Update the DATABASE_URL to point to the new branch

---

## Monitoring & Logs

### Backend Logs
```bash
# SSH into server
ssh -i ~/.ssh/pcs-key.pem ubuntu@43.204.37.17

# Live logs
pm2 logs                      # All apps
pm2 logs pcs-prod             # Only prod
pm2 logs pcs-prod --lines 200 # Last 200 lines

# Log files on disk
ls ~/.pm2/logs/
# pcs-prod-out.log   → stdout
# pcs-prod-error.log → stderr
```

### Server Health
```bash
pm2 status         # Process status, CPU, RAM
pm2 monit          # Real-time monitor
htop               # System-wide CPU/RAM
df -h              # Disk usage
```

### Nginx Logs
```bash
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### AWS Monitoring
- **EC2:** AWS Console → EC2 → Instances → Monitoring tab (CPU, network)
- **S3:** AWS Console → S3 → Bucket → Metrics
- **CloudFront:** AWS Console → CloudFront → Distribution → Monitoring

---

## One-Command Deploy Scripts

### Deploy Everything to Prod
```bash
#!/bin/bash
set -e
echo "🚀 Deploying to PRODUCTION..."

# Backend
cd /home/vboxuser/pcs-platform/backend
npm run build
tar czf /tmp/pcs-backend.tar.gz dist/ package.json package-lock.json
scp -i ~/.ssh/pcs-key.pem /tmp/pcs-backend.tar.gz ubuntu@43.204.37.17:/tmp/
ssh -i ~/.ssh/pcs-key.pem ubuntu@43.204.37.17 'cd /opt/pcs/prod && tar xzf /tmp/pcs-backend.tar.gz && npm install --production && pm2 restart pcs-prod'

# Frontend
cd /home/vboxuser/pcs-platform/frontend
npx ng build --configuration=production
aws s3 sync dist/frontend/browser/ s3://pcs-frontend-prod-primeterminal/ --delete
aws cloudfront create-invalidation --distribution-id E25I57FKXNYW46 --paths "/*"

echo "✅ Production deployment complete!"
```

Save this as `scripts/deploy-prod.sh` and run with `bash scripts/deploy-prod.sh`.

---

*Document created: February 22, 2026*
