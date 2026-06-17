# GoDaddy DNS Configuration — Complete Reference

> Exact DNS records configured for primeterminaltech.com on GoDaddy, pointing the domains at
> **Vercel**. Hosting (frontend + backend) is on Vercel; **SSL and CDN are automatic** — Vercel
> issues and auto-renews the TLS certificate for every custom domain you add. There is no
> certificate to request, no validation record to maintain, and no CDN to configure.

---

## Domain Details
| Field | Value |
|-------|-------|
| Domain | `primeterminaltech.com` |
| Registrar | GoDaddy |
| Nameservers | `ns33.domaincontrol.com`, `ns34.domaincontrol.com` |
| DNS Management URL | https://dcc.godaddy.com/manage/primeterminaltech.com/dns |
| Account Email | `akashmule341@gmail.com` |
| Hosting | Vercel (auto SSL + CDN) |

---

## How This Works on Vercel

You don't point GoDaddy at servers or IPs you manage. For each subdomain:

1. Add the subdomain as a **custom domain** on the matching **Vercel project**
   (**Settings → Domains → Add Domain**).
2. Vercel shows the exact DNS record to create — for a subdomain that's a **CNAME to
   `cname.vercel-dns.com`**; for the apex (root) it's an **A record to `76.76.21.21`**.
3. Add that record here in GoDaddy.
4. Vercel verifies the domain and **automatically provisions + renews TLS**.

> The values below are Vercel's standard public targets. Always confirm against the record shown
> in **your own Vercel dashboard** for each project — the dashboard is the source of truth.

---

## Complete DNS Records

### Record 1: www → Landing Page
| Field | Value |
|-------|-------|
| Type | CNAME |
| Name | `www` |
| Value | `cname.vercel-dns.com` |
| TTL | 600 |
| Purpose | Routes www.primeterminaltech.com to the Vercel landing project |

**Traffic flow:**
```
www.primeterminaltech.com
  → CNAME cname.vercel-dns.com
    → Vercel landing project (TLS + CDN automatic)
```

---

### Record 2: app → PCS Dashboard
| Field | Value |
|-------|-------|
| Type | CNAME |
| Name | `app` |
| Value | `cname.vercel-dns.com` |
| TTL | 600 |
| Purpose | Routes app.primeterminaltech.com to the Vercel production frontend project |

**Traffic flow:**
```
app.primeterminaltech.com
  → CNAME cname.vercel-dns.com
    → Vercel prod frontend project (TLS + CDN automatic)
```

---

### Record 3: api → Backend API
| Field | Value |
|-------|-------|
| Type | CNAME |
| Name | `api` |
| Value | `cname.vercel-dns.com` |
| TTL | 600 |
| Purpose | Routes api.primeterminaltech.com to the Vercel production backend project |

**Traffic flow:**
```
api.primeterminaltech.com
  → CNAME cname.vercel-dns.com
    → Vercel prod backend project (TLS automatic)
```

---

### Record 4: dev → Development Frontend
| Field | Value |
|-------|-------|
| Type | CNAME |
| Name | `dev` |
| Value | `cname.vercel-dns.com` |
| TTL | 600 |
| Purpose | Routes dev.primeterminaltech.com to the Vercel development frontend project |

**Traffic flow:**
```
dev.primeterminaltech.com
  → CNAME cname.vercel-dns.com
    → Vercel dev frontend project (TLS + CDN automatic)
```

---

### Record 5: stage → Staging Frontend
| Field | Value |
|-------|-------|
| Type | CNAME |
| Name | `stage` |
| Value | `cname.vercel-dns.com` |
| TTL | 600 |
| Purpose | Routes stage.primeterminaltech.com to the Vercel staging frontend project |

**Traffic flow:**
```
stage.primeterminaltech.com
  → CNAME cname.vercel-dns.com
    → Vercel staging frontend project (TLS + CDN automatic)
```

---

### Record 6: Root Domain Forwarding
| Field | Value |
|-------|-------|
| Type | Domain Forward |
| From | `primeterminaltech.com` |
| To | `https://www.primeterminaltech.com` |
| Type | 301 (Permanent Redirect) |
| Purpose | Redirects bare domain to www |

> Note: GoDaddy doesn't support a CNAME on the root domain (`@`). Domain forwarding is the
> workaround. Alternatively, add an **A record `@ → 76.76.21.21`**, attach the apex to the Vercel
> landing project, and set it to redirect to `www` inside Vercel's Domains settings.

---

## Summary Table

| Subdomain | Type | Points To | Final Destination | HTTPS |
|-----------|------|-----------|-------------------|-------|
| `primeterminaltech.com` | Forward | → `www.primeterminaltech.com` | Landing page | ✅ |
| `www.primeterminaltech.com` | CNAME | `cname.vercel-dns.com` | Landing page (Vercel) | ✅ (auto) |
| `app.primeterminaltech.com` | CNAME | `cname.vercel-dns.com` | PCS Dashboard (Vercel) | ✅ (auto) |
| `api.primeterminaltech.com` | CNAME | `cname.vercel-dns.com` | Backend API (Vercel) | ✅ (auto) |
| `dev.primeterminaltech.com` | CNAME | `cname.vercel-dns.com` | Dev frontend (Vercel) | ✅ (auto) |
| `stage.primeterminaltech.com` | CNAME | `cname.vercel-dns.com` | Stage frontend (Vercel) | ✅ (auto) |

> Every domain gets HTTPS automatically once Vercel reports **Valid Configuration** — there is no
> separate certificate step.

---

## Notes & Operations

### Environment variables and secrets
App configuration and secrets live as **Vercel Environment Variables** (per project, scoped to
Production / Preview / Development), including `CORS_ORIGIN`, `DATABASE_URL` (Neon PostgreSQL),
`STORAGE_TYPE`, the blob token, and JWT secrets. After changing any variable, **redeploy** the
project so it takes effect.

### Adding a brand-new subdomain
1. Add it as a custom domain on the right Vercel project (**Settings → Domains → Add Domain**).
2. Copy the record Vercel shows (CNAME → `cname.vercel-dns.com`, or A → `76.76.21.21` for an apex).
3. Create that record in GoDaddy.
4. Wait for Vercel to show **Valid Configuration** — TLS is then issued and renewed automatically.

---

## Troubleshooting

### "DNS_PROBE_FINISHED_BAD_CONFIG"
- DNS hasn't propagated yet. Wait 15-30 minutes.
- Try different DNS: change device DNS to 1.1.1.1 (Cloudflare) to test.
- Verify record exists: `dig <subdomain>.primeterminaltech.com +short` — it should resolve toward
  Vercel.

### "This site can't be reached"
- Check the subdomain's status in **Vercel → (project) → Settings → Domains** — it should read
  **Valid Configuration**.
- Confirm the GoDaddy record matches exactly what Vercel asks for (CNAME → `cname.vercel-dns.com`,
  or A → `76.76.21.21` for the apex).
- Make sure the Vercel project has a successful production deployment.

### "404 / Not Found" from the backend
- The domain may be attached to the wrong Vercel project. Confirm `api.*` is on the backend
  project, not the frontend.
- Check the project's latest deployment succeeded and that `CORS_ORIGIN` includes the calling
  frontend domain; redeploy after changing it.

### SSL / Certificate Issues
- Certificates are issued and renewed automatically by Vercel — there is no validation record to
  maintain. A "certificate" error is almost always a DNS problem.
- In **Vercel → Settings → Domains**, if a domain shows **Invalid Configuration**, fix the GoDaddy
  record to match what Vercel displays; Vercel then completes the certificate on its own, usually
  within a minute or two.

---

*Document created: February 22, 2026*
