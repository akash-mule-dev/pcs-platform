# DNS Setup — spadebloom.com

> DNS records needed to connect PCS Platform to spadebloom.com for demo and production.

---

## Domain Plan

| Subdomain | Purpose | Points To |
|-----------|---------|-----------|
| `www.spadebloom.com` | Landing/marketing page | CloudFront → S3 or GitHub Pages |
| `app.spadebloom.com` | Production frontend (Angular) | CloudFront → S3 prod bucket |
| `api.spadebloom.com` | Production backend API | EC2 (43.204.37.17) → Nginx → PM2 :3000 |
| `demo.spadebloom.com` | Demo/staging frontend | CloudFront → S3 stage bucket |
| `demo-api.spadebloom.com` | Demo/staging backend API | EC2 (43.204.37.17) → Nginx → PM2 :3002 |

---

## Step 1: DNS Records to Create

Add these records in your domain registrar (GoDaddy, Cloudflare, Namecheap, etc.):

### Option A: If using Cloudflare (recommended — free SSL + CDN)

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| A | `api` | `43.204.37.17` | DNS only (grey cloud) |
| A | `demo-api` | `43.204.37.17` | DNS only (grey cloud) |
| CNAME | `app` | `d387267ab216kr.cloudfront.net` | DNS only |
| CNAME | `demo` | *(new CloudFront distro for stage)* | DNS only |
| CNAME | `www` | `d2pv0ycsr3grbi.cloudfront.net` | DNS only |

> Use "DNS only" (grey cloud) for all records pointing to AWS CloudFront to avoid SSL conflicts.

### Option B: If using GoDaddy (same as primeterminaltech.com setup)

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | `api` | `43.204.37.17` | 600 |
| A | `demo-api` | `43.204.37.17` | 600 |
| CNAME | `app` | `d387267ab216kr.cloudfront.net` | 600 |
| CNAME | `demo` | *(new CloudFront distro for stage)* | 600 |
| CNAME | `www` | `d2pv0ycsr3grbi.cloudfront.net` | 600 |
| Forward | `@` (root) | → `https://www.spadebloom.com` | 301 |

---

## Step 2: SSL Certificate (AWS ACM)

You need a new SSL certificate for spadebloom.com in AWS Certificate Manager.

```bash
# Request certificate (must be in us-east-1 for CloudFront)
aws acm request-certificate \
  --region us-east-1 \
  --domain-name "spadebloom.com" \
  --subject-alternative-names "*.spadebloom.com" \
  --validation-method DNS

# This outputs a CertificateArn — save it
```

After requesting, AWS gives you a CNAME validation record. Add it to your DNS:

| Type | Name | Value |
|------|------|-------|
| CNAME | `_<hash>.spadebloom.com` | `_<hash>.acm-validations.aws.` |

Wait for validation (usually 5-15 minutes). Verify:
```bash
aws acm describe-certificate --region us-east-1 --certificate-arn <arn> \
  --query 'Certificate.Status'
# Should return "ISSUED"
```

---

## Step 3: Update CloudFront Distributions

### Production frontend (app.spadebloom.com)

```bash
# Get current CloudFront config
aws cloudfront get-distribution-config --id E_PROD_DIST_ID > /tmp/cf-prod.json

# Edit the config to add:
# - "Aliases": add "app.spadebloom.com"
# - "ViewerCertificate": set the new ACM certificate ARN
# Then update:
aws cloudfront update-distribution --id E_PROD_DIST_ID --distribution-config file:///tmp/cf-prod-updated.json --if-match <ETag>
```

### Demo/staging frontend (demo.spadebloom.com)

Create a new CloudFront distribution or update the existing stage one:
- Origin: S3 stage bucket (`pcs-frontend-stage-primeterminal`)
- Alternate domain: `demo.spadebloom.com`
- SSL certificate: the wildcard `*.spadebloom.com` cert from Step 2

---

## Step 4: Update Nginx on EC2

SSH into the EC2 instance and update Nginx to handle the new domains:

```bash
ssh -i ~/.ssh/pcs-key.pem ubuntu@43.204.37.17
```

Add new server blocks to `/etc/nginx/sites-available/pcs`:

```nginx
# api.spadebloom.com → Production backend
server {
    listen 80;
    server_name api.spadebloom.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}

# demo-api.spadebloom.com → Stage backend
server {
    listen 80;
    server_name demo-api.spadebloom.com;

    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Then install SSL with Certbot:
```bash
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.spadebloom.com -d demo-api.spadebloom.com
```

---

## Step 5: Update PM2 Environment Variables

Update CORS origins for each PM2 process:

```bash
# Production
pm2 set pcs-prod:CORS_ORIGIN "https://app.spadebloom.com,https://www.spadebloom.com,https://app.primeterminaltech.com"

# Stage/Demo
pm2 set pcs-stage:CORS_ORIGIN "https://demo.spadebloom.com,http://stage.primeterminaltech.com"

# Restart processes
pm2 restart pcs-prod pcs-stage
```

Or edit the PM2 ecosystem file:
```bash
nano /opt/pcs/ecosystem.config.js
```

Add to each process env:
```javascript
// pcs-prod
CORS_ORIGIN: 'https://app.spadebloom.com,https://www.spadebloom.com'

// pcs-stage
CORS_ORIGIN: 'https://demo.spadebloom.com'
```

---

## Step 6: Verify Everything

```bash
# DNS propagation (may take 5-30 minutes)
dig app.spadebloom.com +short
dig api.spadebloom.com +short
dig demo.spadebloom.com +short
dig demo-api.spadebloom.com +short

# API health check
curl https://api.spadebloom.com/api/health
curl https://demo-api.spadebloom.com/api/health

# Frontend loads
curl -sI https://app.spadebloom.com | head -5
curl -sI https://demo.spadebloom.com | head -5
```

---

## Quick Reference

| What | Old (primeterminaltech.com) | New (spadebloom.com) |
|------|---------------------------|---------------------|
| Landing page | www.primeterminaltech.com | www.spadebloom.com |
| Production app | app.primeterminaltech.com | app.spadebloom.com |
| Production API | api.primeterminaltech.com | api.spadebloom.com |
| Staging app | stage.primeterminaltech.com | demo.spadebloom.com |
| Staging API | 43.204.37.17:3002 | demo-api.spadebloom.com |

---

*Document created: March 23, 2026*
