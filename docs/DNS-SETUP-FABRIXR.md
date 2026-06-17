# DNS Setup — fabrixr.com

> DNS records needed to connect PCS Platform (FabriXR) to fabrixr.com for demo and production.
> Hosting is on **Vercel** (frontend + backend). SSL and CDN are automatic — Vercel issues and
> auto-renews TLS certificates for every custom domain you add, so there is nothing to request,
> validate, or renew by hand.

---

## Domain Plan

| Subdomain | Purpose | Hosted On |
|-----------|---------|-----------|
| `www.fabrixr.com` | Landing/marketing page | Vercel (landing project) |
| `app.fabrixr.com` | Production frontend (Angular) | Vercel (prod frontend project) |
| `api.fabrixr.com` | Production backend API | Vercel (prod backend project) |
| `pcsapi.fabrixr.com` | Production backend API (alias) | Vercel (prod backend project) |
| `demo.fabrixr.com` | Demo/staging frontend | Vercel (staging frontend project) |
| `demo-api.fabrixr.com` | Demo/staging backend API | Vercel (staging backend project) |
| `fabrixr.com` (apex) | Redirect → `www.fabrixr.com` | Registrar forward / Vercel redirect |

> Each subdomain is a custom domain on the corresponding Vercel project. The database stays on
> **Neon PostgreSQL** — unchanged by this DNS work.

---

## How Vercel Domains Work (read this first)

On Vercel you don't point DNS at servers, IPs, CDNs, or certificates you manage. Instead:

1. Open the **Vercel project** that should serve a given subdomain.
2. Go to **Settings → Domains** and click **Add Domain**.
3. Enter the subdomain (e.g. `app.fabrixr.com`).
4. Vercel shows you the **exact DNS record** to create at your registrar — almost always a
   **CNAME to `cname.vercel-dns.com`** for a subdomain, or an **A record to `76.76.21.21`** for
   the apex (root) domain.
5. Add that record at your registrar (see Step 1 below for GoDaddy).
6. Vercel verifies the domain, then **automatically provisions and renews the TLS certificate** —
   no certificate request, no validation CNAME to babysit, no CDN config.

> Always follow the **exact records shown in your own Vercel dashboard** for each project — the
> values below are Vercel's standard public targets and are correct in the common case, but the
> dashboard is the source of truth for your specific project.

---

## Step 1: DNS Records to Create

Add these records in your domain registrar (GoDaddy, Cloudflare, Namecheap, etc.). Every
subdomain is a CNAME to Vercel's anycast DNS target; the apex uses an A record (or registrar
forwarding) because most registrars can't CNAME the root.

### Option A: If using Cloudflare

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| CNAME | `www` | `cname.vercel-dns.com` | DNS only (grey cloud) |
| CNAME | `app` | `cname.vercel-dns.com` | DNS only (grey cloud) |
| CNAME | `api` | `cname.vercel-dns.com` | DNS only (grey cloud) |
| CNAME | `pcsapi` | `cname.vercel-dns.com` | DNS only (grey cloud) |
| CNAME | `demo` | `cname.vercel-dns.com` | DNS only (grey cloud) |
| CNAME | `demo-api` | `cname.vercel-dns.com` | DNS only (grey cloud) |
| A | `@` (root) | `76.76.21.21` | DNS only (grey cloud) |

> Use **"DNS only" (grey cloud)** for every record pointing at Vercel — Vercel terminates TLS and
> serves the CDN itself, so proxying through Cloudflare would conflict with its certificates.

### Option B: If using GoDaddy

| Type | Name | Value | TTL |
|------|------|-------|-----|
| CNAME | `www` | `cname.vercel-dns.com` | 600 |
| CNAME | `app` | `cname.vercel-dns.com` | 600 |
| CNAME | `api` | `cname.vercel-dns.com` | 600 |
| CNAME | `pcsapi` | `cname.vercel-dns.com` | 600 |
| CNAME | `demo` | `cname.vercel-dns.com` | 600 |
| CNAME | `demo-api` | `cname.vercel-dns.com` | 600 |
| Forward | `@` (root) | → `https://www.fabrixr.com` | 301 |

> GoDaddy can't put a CNAME on the root (`@`), so use **Domain Forwarding** to send the apex to
> `www`, or add an **A record `@ → 76.76.21.21`** if you'd rather Vercel serve the apex directly
> (configure the redirect to `www` inside Vercel in that case).

---

## Step 2: Add Each Domain in Vercel

For each subdomain, add it as a custom domain on the right Vercel project, then create the DNS
record Vercel shows you (Step 1 already lists the standard values). The project map:

| Subdomain | Vercel Project | Record Vercel will ask for |
|-----------|----------------|----------------------------|
| `www.fabrixr.com` | landing | CNAME → `cname.vercel-dns.com` |
| `app.fabrixr.com` | prod frontend | CNAME → `cname.vercel-dns.com` |
| `api.fabrixr.com` | prod backend | CNAME → `cname.vercel-dns.com` |
| `pcsapi.fabrixr.com` | prod backend | CNAME → `cname.vercel-dns.com` |
| `demo.fabrixr.com` | staging frontend | CNAME → `cname.vercel-dns.com` |
| `demo-api.fabrixr.com` | staging backend | CNAME → `cname.vercel-dns.com` |
| `fabrixr.com` (apex) | landing (redirect → www) | A → `76.76.21.21` |

Steps per domain:

1. Vercel **Dashboard → (project) → Settings → Domains → Add Domain**.
2. Type the subdomain and confirm.
3. Copy the record Vercel displays and create it at your registrar (it will match the values in
   Step 1 in the common case — but use what the dashboard shows).
4. Wait for Vercel to flip the domain to **Valid Configuration**.

---

## Step 3: SSL Certificates — Nothing To Do

Vercel **automatically issues and auto-renews** a TLS certificate for every domain once its DNS
points at Vercel and the domain shows **Valid Configuration**. There is no certificate to request,
no validation record to add, and no renewal to schedule. If a domain is stuck on "Invalid
Configuration," it's a DNS problem (wrong/missing record), not a certificate problem — fix the
record and Vercel finishes the cert on its own, usually within a minute or two.

---

## Step 4: Apex (root) Redirect → www

`fabrixr.com` should land users on `www.fabrixr.com`. Two ways:

- **Registrar forwarding (simplest):** GoDaddy → Domain Forwarding → forward `fabrixr.com` to
  `https://www.fabrixr.com` with a **301 (permanent)** redirect.
- **Vercel redirect:** add an **A record `@ → 76.76.21.21`**, add `fabrixr.com` to the landing
  project in Vercel, and set it to **Redirect to `www.fabrixr.com`** in the project's Domains
  settings.

---

## Step 5: Set Environment Variables in Vercel

Configuration and secrets live as **Vercel Environment Variables** (per project, scoped to
Production / Preview / Development) — not in process managers or server config. Set the CORS
origins so the backend accepts the FabriXR frontends:

| Project | Variable | Value |
|---------|----------|-------|
| prod backend | `CORS_ORIGIN` | `https://app.fabrixr.com,https://www.fabrixr.com` |
| staging backend | `CORS_ORIGIN` | `https://demo.fabrixr.com` |

Set these under **Vercel → (project) → Settings → Environment Variables**, then **redeploy** the
project so the new values take effect. Keep `DATABASE_URL` (Neon PostgreSQL), `STORAGE_TYPE`, the
blob token, and JWT secrets as Vercel Environment Variables too — the database and storage are
unchanged by this DNS work.

---

## Step 6: Verify Everything

```bash
# DNS propagation (may take 5-30 minutes) — subdomains should resolve toward Vercel
dig app.fabrixr.com +short
dig api.fabrixr.com +short
dig pcsapi.fabrixr.com +short
dig demo.fabrixr.com +short
dig demo-api.fabrixr.com +short

# API health check (TLS served by Vercel)
curl https://api.fabrixr.com/api/health
curl https://demo-api.fabrixr.com/api/health

# Frontend loads
curl -sI https://app.fabrixr.com | head -5
curl -sI https://demo.fabrixr.com | head -5
```

In the Vercel dashboard, each domain under **Settings → Domains** should read **Valid
Configuration** with TLS enabled. If a domain is marked invalid, recheck the registrar record
against what Vercel asks for.

---

## Quick Reference

| Role | Domain | Points at |
|------|--------|-----------|
| Landing page | www.fabrixr.com | Vercel landing project |
| Production app | app.fabrixr.com | Vercel production frontend |
| Production API | api.fabrixr.com / pcsapi.fabrixr.com | Vercel production backend |
| Staging app | demo.fabrixr.com | Vercel staging frontend |
| Staging API | demo-api.fabrixr.com | Vercel staging backend |
| Hosting | — | Vercel (auto SSL + CDN) |

---

*Document created: March 23, 2026*
