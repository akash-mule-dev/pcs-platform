# GoDaddy DNS Configuration — Complete Reference

> Exact DNS records configured for primeterminaltech.com on GoDaddy.

---

## Domain Details
| Field | Value |
|-------|-------|
| Domain | `primeterminaltech.com` |
| Registrar | GoDaddy |
| Nameservers | `ns33.domaincontrol.com`, `ns34.domaincontrol.com` |
| DNS Management URL | https://dcc.godaddy.com/manage/primeterminaltech.com/dns |
| Account Email | `akashmule341@gmail.com` |

---

## Complete DNS Records

### Record 1: SSL Certificate Validation
| Field | Value |
|-------|-------|
| Type | CNAME |
| Name | `_fd561ddaaefe1ba0ccfe78875232245f` |
| Value | `_fb50f18beaef6913de373162866976e7.jkddzztszm.acm-validations.aws.` |
| TTL | 600 |
| Purpose | AWS ACM SSL certificate validation & auto-renewal |

> ⚠️ **CRITICAL: Never delete this record.** It's required for the SSL certificate to auto-renew. If deleted, HTTPS will stop working within 60 days.

---

### Record 2: www → Landing Page
| Field | Value |
|-------|-------|
| Type | CNAME |
| Name | `www` |
| Value | `d2pv0ycsr3grbi.cloudfront.net` |
| TTL | 600 |
| Purpose | Routes www.primeterminaltech.com to CloudFront → GitHub Pages landing page |

**Traffic flow:**
```
www.primeterminaltech.com
  → CloudFront (d2pv0ycsr3grbi.cloudfront.net)
    → GitHub Pages (akash-mule-dev.github.io/pcs-website)
```

---

### Record 3: app → PCS Dashboard
| Field | Value |
|-------|-------|
| Type | CNAME |
| Name | `app` |
| Value | `d387267ab216kr.cloudfront.net` |
| TTL | 600 |
| Purpose | Routes app.primeterminaltech.com to CloudFront → S3 prod frontend |

**Traffic flow:**
```
app.primeterminaltech.com
  → CloudFront (d387267ab216kr.cloudfront.net)
    → S3 (pcs-frontend-prod-primeterminal bucket)
```

---

### Record 4: api → Backend Server
| Field | Value |
|-------|-------|
| Type | A |
| Name | `api` |
| Value | `43.204.37.17` |
| TTL | 600 |
| Purpose | Routes api.primeterminaltech.com to EC2 instance → Nginx → PM2 prod backend |

**Traffic flow:**
```
api.primeterminaltech.com
  → EC2 (43.204.37.17)
    → Nginx (port 80)
      → PM2 pcs-prod (port 3000)
```

---

### Record 5: dev → Development Frontend
| Field | Value |
|-------|-------|
| Type | A |
| Name | `dev` |
| Value | `43.204.37.17` |
| TTL | 600 |
| Purpose | Routes dev.primeterminaltech.com to EC2 → Nginx → S3 dev bucket |

**Traffic flow:**
```
dev.primeterminaltech.com
  → EC2 (43.204.37.17)
    → Nginx (port 80)
      → S3 (pcs-frontend-dev-primeterminal bucket)
```

---

### Record 6: stage → Staging Frontend
| Field | Value |
|-------|-------|
| Type | A |
| Name | `stage` |
| Value | `43.204.37.17` |
| TTL | 600 |
| Purpose | Routes stage.primeterminaltech.com to EC2 → Nginx → S3 stage bucket |

**Traffic flow:**
```
stage.primeterminaltech.com
  → EC2 (43.204.37.17)
    → Nginx (port 80)
      → S3 (pcs-frontend-stage-primeterminal bucket)
```

---

### Record 7: Root Domain Forwarding
| Field | Value |
|-------|-------|
| Type | Domain Forward |
| From | `primeterminaltech.com` |
| To | `https://www.primeterminaltech.com` |
| Type | 301 (Permanent Redirect) |
| Purpose | Redirects bare domain to www |

> Note: GoDaddy doesn't support CNAME on the root domain (@). Domain forwarding is the workaround.

---

## Summary Table

| Subdomain | Type | Points To | Final Destination | HTTPS |
|-----------|------|-----------|-------------------|-------|
| `primeterminaltech.com` | Forward | → `www.primeterminaltech.com` | Landing page | ✅ |
| `www.primeterminaltech.com` | CNAME | CloudFront | Landing page (GitHub Pages) | ✅ |
| `app.primeterminaltech.com` | CNAME | CloudFront | PCS Dashboard (S3) | ✅ |
| `api.primeterminaltech.com` | A | EC2 | Backend API (Nginx → PM2) | ❌ (HTTP only*) |
| `dev.primeterminaltech.com` | A | EC2 | Dev frontend (Nginx → S3) | ❌ (HTTP only*) |
| `stage.primeterminaltech.com` | A | EC2 | Stage frontend (Nginx → S3) | ❌ (HTTP only*) |

*To add HTTPS to api/dev/stage, install Let's Encrypt (Certbot) on the EC2 instance. See "Future Improvements" below.

---

## Future Improvements

### Add HTTPS to api/dev/stage (Let's Encrypt)
```bash
# SSH into EC2
ssh -i ~/.ssh/pcs-key.pem ubuntu@43.204.37.17

# Install Certbot
sudo apt install certbot python3-certbot-nginx -y

# Get certificates for all subdomains
sudo certbot --nginx -d api.primeterminaltech.com -d dev.primeterminaltech.com -d stage.primeterminaltech.com

# Auto-renewal is set up automatically by Certbot
```

### If EC2 IP Changes
If you stop and start the EC2 instance (not reboot), the public IP may change. You'd need to:
1. Get the new IP: `aws ec2 describe-instances --instance-ids i-02140b6fbb9abf976 --query 'Reservations[0].Instances[0].PublicIpAddress'`
2. Update GoDaddy A records for `api`, `dev`, `stage`
3. To prevent this, attach an **Elastic IP** (free while instance is running):
   ```bash
   aws ec2 allocate-address --domain vpc
   aws ec2 associate-address --instance-id i-02140b6fbb9abf976 --allocation-id <eipalloc-id>
   ```

---

## Troubleshooting

### "DNS_PROBE_FINISHED_BAD_CONFIG"
- DNS hasn't propagated yet. Wait 15-30 minutes.
- Try different DNS: Change device DNS to 1.1.1.1 (Cloudflare) to test.
- Verify record exists: `dig <subdomain>.primeterminaltech.com +short`

### "This site can't be reached"
- Check if EC2 is running: `aws ec2 describe-instance-status --instance-ids i-02140b6fbb9abf976`
- Check if PM2 is running: SSH in → `pm2 status`
- Check security group allows the port

### "502 Bad Gateway"
- Nginx is running but the backend isn't
- SSH in → `pm2 status` → restart the failed process

### SSL Certificate Issues
- Never delete the ACM validation CNAME record
- Check certificate status: `aws acm describe-certificate --region us-east-1 --certificate-arn <arn>`

---

*Document created: February 22, 2026*
