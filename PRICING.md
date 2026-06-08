# PCS Platform — Pricing & ARR Model

**Product:** Multi-tenant manufacturing execution system (MES) for fabrication shops —
production routing, quality (NCR/SPC/traceability), labor, scheduling, costing, and a
differentiated **3D/IFC + AR model viewer**.

**Target:** Blended **SMB + mid-market fabricators** (North America), **sales-led**,
displacing spreadsheets, whiteboards, and legacy point tools (FabSuite/Tekla EPM, generic MES).

**Billing reality (from [PRODUCT-SCOPE-multi-tenant.md](PRODUCT-SCOPE-multi-tenant.md)):**
per-tenant metering and plan enforcement are *out of current scope*, and tenants are
operator-provisioned. So everything below is **flat per-site subscription** — which is
also how this market prefers to buy. Usage-based pricing (e.g. per CAD conversion) is a
future add-on once metering exists.

> 📊 **Live model:** [PCS-Pricing-Model.xlsx](PCS-Pricing-Model.xlsx) — edit the blue
> assumption cells and the ARR cohorts + unit economics recompute. Regenerate the file
> with `python _build_pricing_xlsx.py`. This doc is the narrative; the workbook is the math.

---

## 1. Pricing one-pager

### Metric: price per production **site**, not per seat
Shop floors have many low-value, device-sharing operators; per-operator pricing gets
rejected and is gamed. Charge per **site/plant**, bundle unlimited floor/kiosk access,
and count only **named office/admin seats** (planners, supervisors, QA).

### Tiers (annual contract, billed annually, per site)

| Tier | Best for | Includes | List / site / mo | List / site / yr |
|---|---|---|---|---|
| **Core MES** | Single SMB shop | Work orders, routing (processes→lines→stations→stages), time-tracking, basic quality, dashboard, RBAC | **$1,000** | **$12,000** |
| **Quality & Traceability** | Compliance/audit-driven shops | + NCR, **SPC**, full traceability, audit log, scheduling/coordination, costing | **$2,500** | **$30,000** |
| **Digital Twin / AR** ⭐ | Fabricators doing 3D coordination | + 3D/IFC viewer, **CAD conversion**, mobile **AR**, model-linked work orders | **$4,500** | **$54,000** |
| **Enterprise** | Multi-site / multi-org | Everything + multi-site rollup, SSO/SCIM, API, white-label, data-residency, SLA | **Custom** | **$60k–$150k+** |

> ⭐ The 3D/IFC/AR + CAD-conversion capability is the real moat versus commodity MES.
> Gate it as the premium tier; don't bundle it into Core.

### Add-ons
- **Named office/admin seats:** $60/user/mo ($720/yr). Floor/operator access: **unlimited, included.**
- **Additional sites:** same tier price, with volume discount (see §1.3).
- **CAD-conversion overage** *(future, once metered):* first N conversions/mo included, then per-conversion — this is the one feature with real marginal compute cost.

### Implementation & terms
- **One-time onboarding fee** (routing setup, data migration, training): **SMB $7,500 · Mid-market $20,000+.** MES is high-touch; customers expect this and it funds your CS.
- **Annual contracts**, auto-renew. Month-to-month only as a premium-priced pilot.
- **Multi-site discount:** sites 2–5 = −15%, 6–10 = −25%, 11+ = custom.
- **Annual prepay** standard; quarterly allowed at list, monthly at +15%.

### Discount guardrails
- Floor at **−25%** without VP approval; never discount the implementation fee (signals the work is optional).
- Trade discount for **term** (multi-year) or **logo/case-study rights**, not for nothing.

---

## 2. ARR model — blended SMB + mid-market

### Per-segment blended ACV (build-up)

| Segment | Typical config | Subscription | Seats | **Blended ACV** | Onboarding (one-time) |
|---|---|---|---|---|---|
| **SMB** | 1 site, Core↔Quality mix (skew Core), ~5 office seats | ~$18.4k | ~$3.6k | **≈ $22k** | $7,500 |
| **Mid-market** | avg 4 sites @ Quality↔Digital Twin (post multi-site discount), ~20 seats | ~$135k | ~$14k | **≈ $150k** | $20,000 |

### Retention assumptions
- **Gross logo churn:** SMB 15%/yr · Mid 8%/yr
- **Net revenue retention** (expansion = added sites, tier upgrades, seats): **SMB 100% · Mid 115%**

### New-logo plan (Base) and scenario multipliers

| | Y1 | Y2 | Y3 |
|---|---|---|---|
| SMB new logos (Base) | 12 | 25 | 40 |
| Mid new logos (Base) | 2 | 5 | 9 |
| **Low** = ~0.6× Base · **High** = ~1.5× Base | | | |

### Ending ARR by scenario (cohorts tracked separately, then summed)

| Scenario | Y1 ARR | Y2 ARR | Y3 ARR |
|---|---|---|---|
| **Low** | $0.30M | $1.1M | **$2.5M** |
| **Base** | $0.56M | $1.9M | **$4.3M** |
| **High** | $0.85M | $2.9M | **$6.6M** |

**Base-case detail (ending ARR):**
- SMB pool (NRR 100%): Y1 $264k → Y2 $814k → Y3 $1.69M
- Mid pool (NRR 115%): Y1 $300k → Y2 $1.10M → Y3 $2.61M

**One-time services revenue (cash, not ARR):** Base Y1 $130k · Y2 $288k · Y3 $480k.

### What moves the number (sensitivities, biggest first)
1. **Mid-market new-logo pace & ACV** — each mid logo ≈ 7 SMB logos. Closing 2 extra mid deals/yr beats 12 extra SMB deals. *Focus sales here.*
2. **Mid-market NRR** — expansion via added sites is where the compounding is; 115% → 125% materially bends Y3.
3. **SMB churn** — single-site SMBs churn; at 15%+ the SMB pool barely compounds. Tier upgrades (Core→Quality→Digital Twin) are the retention lever.
4. **Tier mix** — every customer that lands on **Digital Twin/AR** roughly doubles per-site ACV vs Core. Lead demos with the 3D/AR moat.

---

## 3. Unit economics

Margin and capital-efficiency per segment (blended = logo-weighted by the Base plan).
The one real COGS line that scales with usage is **CAD-conversion compute** — everything
else (work orders, quality, time-tracking) is near-zero marginal cost, which is why it's
the first candidate to meter later.

| Metric | SMB | Mid-market | Blended |
|---|---|---|---|
| ACV / yr | $22,000 | $150,000 | ~$44,000 |
| COGS / yr (hosting + **CAD compute** + support + payments) | $5,250 | $22,550 | — |
| **Gross margin** | **76%** | **85%** | **~81%** |
| CAC per logo | $8,000 | $45,000 | ~$14,400 |
| Onboarding fee (offsets CAC) | $7,500 | $20,000 | — |
| **Net CAC** (after onboarding gross profit) | $5,000 | $37,000 | — |
| CAC payback (gross margin basis) | 5.7 mo | 4.2 mo | ~4.8 mo |
| **Net CAC payback** | **3.6 mo** | **3.5 mo** | ~3.5 mo |
| LTV (gross margin ÷ churn, no expansion) | $112k | $1.59M | ~$367k |
| **LTV:CAC** | **14×** | **35×** | **~25×** |

**Reads:**
- **Margins are healthy** (76–85%) and improve with scale — the only meaningful COGS is
  CAD-conversion compute, which only Digital-Twin-tier customers incur.
- **Onboarding fees nearly pay back CAC on day one** (SMB net CAC $5k vs $7.5k fee at 40%
  margin) — payback under 4 months in both segments. This is a real strength; don't discount onboarding.
- **The LTV:CAC ratios (14×–35×) are flattering and entirely gated by the churn
  assumptions.** At 15% SMB / 8% mid churn the implied lifetimes are 6.7 / 12.5 years. If
  real SMB churn is 25%+, SMB LTV roughly halves. **Treat these as a ceiling and validate
  churn before quoting them to anyone.** Flex the churn cells in the workbook to see the swing.

## 4. Open questions to validate before going live
- **Willingness-to-pay:** validate the $12k / $30k / $54k anchors with 5–10 target shops (van Westendorp or simple "too cheap / too expensive" interviews).
- **Competitive frame:** confirm who you displace per segment — anchors low vs spreadsheets, high vs Tekla EPM.
- **Metering roadmap:** if you want usage-based CAD-conversion or AR pricing later, that depends on building per-tenant metering (currently a non-goal — see scope doc §2).

> *Figures are illustrative planning anchors, not committed list prices. Validate WTP before publishing.*
