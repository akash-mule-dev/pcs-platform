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

> 📊 **Live model:** [PCS-Pricing-Model.xlsx](PCS-Pricing-Model.xlsx) — six tabs (US + India,
> each with Assumptions / ARR Model / Unit Economics). Edit the blue assumption cells and the
> ARR cohorts + unit economics recompute. Regenerate with `python _build_pricing_xlsx.py`.
> This doc is the narrative; the workbook is the math.

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

## 2. Feature matrix per tier

Mapped to what's **actually in the codebase** (backend modules + frontend/mobile screens), not
generic SaaS bullets. Tiers are **additive** — each includes everything to its left.

**Legend:** ✓ shipped · ◐ partial / in progress · ○ included but on roadmap (not yet built) · — not in tier

### Production execution

| Capability | Modules | Core | Quality | Digital Twin | Enterprise |
|---|---|:--:|:--:|:--:|:--:|
| Work orders — list / detail / forms / **Kanban** | `work-orders` | ✓ | ✓ | ✓ | ✓ |
| Process definitions | `processes` | ✓ | ✓ | ✓ | ✓ |
| Routing: lines → stations → stages | `lines` `stations` `stages` | ✓ | ✓ | ✓ | ✓ |
| Operations dashboard / KPIs | `dashboard` | ✓ | ✓ | ✓ | ✓ |
| Global search | `search` | ✓ | ✓ | ✓ | ✓ |
| Work-order & process templates | `templates` | ✓ | ✓ | ✓ | ✓ |
| Time tracking — live + history | `time-tracking` | ✓ | ✓ | ✓ | ✓ |
| Basic quality capture (pass/fail at stage) | `quality-data` | ✓ | ✓ | ✓ | ✓ |
| Real-time updates (Socket.io) | `websocket` | ✓ | ✓ | ✓ | ✓ |
| Notifications | `notifications` `alerts` | ✓ | ✓ | ✓ | ✓ |
| Users + basic roles | `users` `auth` | ✓ | ✓ | ✓ | ✓ |
| Mobile shop-floor app (WO / time / dashboard) | `mobile` | ✓ | ✓ | ✓ | ✓ |

### Quality & operations depth

| Capability | Modules | Core | Quality | Digital Twin | Enterprise |
|---|---|:--:|:--:|:--:|:--:|
| NCR — non-conformance reports | `quality-ncr/ncr` | — | ✓ | ✓ | ✓ |
| CAPA — corrective & preventive action | `quality-ncr/capa` | — | ✓ | ✓ | ✓ |
| SPC — statistical process control | `spc` | — | ✓ | ✓ | ✓ |
| Full traceability / genealogy | `traceability` | — | ✓ | ✓ | ✓ |
| Quality analytics | `quality-analysis` | — | ✓ | ✓ | ✓ |
| Full audit log | `audit` | — | ✓ | ✓ | ✓ |
| Equipment + maintenance | `equipment` | — | ✓ | ✓ | ✓ |
| Materials + **BOM** + inventory | `materials` | — | ✓ | ✓ | ✓ |
| Workforce — attendance / shifts / skills | `workforce` | — | ✓ | ✓ | ✓ |
| Production scheduling | `scheduling` | — | ✓ | ✓ | ✓ |
| Coordination | `coordination` | — | ✓ | ✓ | ✓ |
| Costing (job) | `costing` | — | ✓ | ✓ | ✓ |
| Reports suite | `reports` | — | ✓ | ✓ | ✓ |
| Granular RBAC | `rbac` | — | ✓ | ✓ | ✓ |
| Mobile: raise NCR on floor | `mobile/more` | — | ◐ | ◐ | ◐ |

### Digital twin / model-driven (your differentiator)

| Capability | Modules | Core | Quality | Digital Twin | Enterprise |
|---|---|:--:|:--:|:--:|:--:|
| 3D / GLB model viewer | `engineering/glb-viewer` `models` | — | — | ✓ | ✓ |
| IFC / CAD conversion | `cad-conversion` `conversion` | — | — | ✓ | ✓ |
| Projects: IFC import → auto WO generation | `projects` | — | — | ✓ | ✓ |
| Shipping management | `shipping` | — | — | ✓ | ✓ |
| Model-linked work orders | `projects` `work-orders` | — | — | ✓ | ✓ |
| Mobile AR model viewer / inspection | `mobile/model-viewer` | — | — | ✓ | ✓ |

### Enterprise (scale, security, control)

| Capability | Modules / status | Core | Quality | Digital Twin | Enterprise |
|---|---|:--:|:--:|:--:|:--:|
| Multi-tenant data isolation (RLS) | `organization` + RLS | ◐ | ◐ | ◐ | ✓ |
| Multi-site / multi-org rollup & switching | `organization` (Phase E) | — | — | — | ◐ |
| SSO / SCIM provisioning | roadmap | — | — | — | ○ |
| Public / documented API access | REST exists, public API | — | — | — | ◐ |
| White-label / theming | roadmap | — | — | — | ○ |
| Data residency / per-tenant DB | roadmap | — | — | — | ○ |
| Advanced compliance exports | roadmap | — | — | — | ○ |
| Priority SLA & dedicated support | operational | — | — | — | ✓ |

> **Sellable-today reality:** Core, Quality, and Digital Twin tiers are built and demoable.
> The **Enterprise** tier is partly roadmap — multi-tenant isolation (RLS) and tenant admin are
> in progress ([PRODUCT-SCOPE-multi-tenant.md](PRODUCT-SCOPE-multi-tenant.md) Phases C–E), and
> SSO/SCIM, white-label, data residency are not started. Sell Enterprise as design-partner /
> roadmap-committed, not as shipped, until those phases land.

## 3. India pricing (INR)

A **re-anchor**, not a discount — see the [India Assumptions / ARR / Unit Economics] tabs in the
workbook. Same model and per-site metric; different absolute numbers, billing behaviour, and tax.

**Why India is a different price world**
- Indian manufacturing SMBs benchmark software against **Zoho / Tally**, not Salesforce. Realistic
  price ≈ **12–15% of the US number** — and this holds across **both SMB and mid-market**, because
  mid-market simply buys *more sites* of the same list, not a higher per-site rate. Only the
  **Enterprise** custom tier climbs toward **30–45% of US**, where large EPC players (L&T, Tata
  Projects, PEB majors) have near-global budgets.
- Buying behaviour is "perpetual-license-era" (Tally) — big upfront fees and annual prepay are
  resisted harder; monthly billing is more acceptable.
- Per-seat is even more toxic (cheap, plentiful labour) — per-**site** is essential.

### India tiers (per site, **ex-GST**, ₹/USD ≈ 85)

| Tier | ₹ / site / month | ₹ / site / year | ~USD/yr |
|---|---|---|---|
| **Core MES** | ₹8,000–15,000 | ₹1.0L–1.8L | ~$1,200–2,100 |
| **Quality & Traceability** | ₹20,000–35,000 | ₹2.4L–4.2L | ~$2,800–4,900 |
| **Digital Twin / AR** | ₹40,000–65,000 | ₹4.8L–7.8L | ~$5,600–9,200 |
| **Enterprise** (multi-site EPC) | Custom | ₹15L–60L+ | ~$18k–70k+ |

- **Office/admin seats:** ₹600–1,200/user/mo; floor access unlimited. Multi-site discount as US.
- **Onboarding:** SMB ₹30k–75k · Mid ₹2L–6L · Enterprise ₹10L+ (sized to cheaper local implementation labour).
- **Tax mechanics:** quote ex-GST; add **18% GST** (B2B reclaims as input credit). Customers often deduct **~2% TDS** on the services/onboarding portion.
- **Billing:** offer monthly more readily than in the US, but incentivise annual prepay (~2 months free).

### The margin trap — read this before scaling India

Hosting and **CAD-conversion compute are USD-priced** (cloud is global) and **do not localise down**,
while prices drop ~85%. Result, from the workbook:

| | US | India |
|---|--:|--:|
| SMB gross margin (non-3D tiers) | 76% | **76%** |
| Mid / Digital-Twin gross margin | 85% | **~63%** |

The Digital Twin tier's 3D/CAD compute — your differentiator — is the one cost that doesn't shrink,
so it eats ~22% of Indian revenue on that tier. **Implications:** (a) optimise/cache IFC/CAD
conversion to cut compute, (b) meter CAD conversion as a paid add-on in India once metering exists, or
(c) make the margin on **Quality-tier volume** and treat Digital Twin as a strategic/differentiating
loss-leader. SMB stays healthy because it doesn't touch 3D.

### India ARR (Base scenario, INR-volume logo mix)

Lower ACV (SMB ~₹2.5L, Mid ~₹17.5L), heavier SMB logo volume (Make-in-India MSME base):

| Scenario | Y1 | Y2 | Y3 |
|---|---|---|---|
| Low | ₹0.65 Cr | ₹2.29 Cr | **₹5.29 Cr** |
| Base | ₹1.02 Cr | ₹3.70 Cr | **₹8.69 Cr** (~$1.02M) |
| High | ₹1.45 Cr | ₹5.46 Cr | **₹12.84 Cr** |

> **Geo-fence it.** Keep INR pricing on an India billing entity for India-domiciled customers only.
> If a US prospect sees the ₹ rate converted, it anchors down deals worth 5–8× the ACV.

## 4. ARR model — blended SMB + mid-market (US, USD)

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

## 5. Unit economics (US)

Margin and capital-efficiency per segment (blended = logo-weighted by the Base plan).
*India unit economics differ materially — see §3 and the India Unit Economics tab.*
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

## 6. Open questions to validate before going live
- **Willingness-to-pay:** validate the $12k / $30k / $54k anchors with 5–10 target shops (van Westendorp or simple "too cheap / too expensive" interviews).
- **Competitive frame:** confirm who you displace per segment — anchors low vs spreadsheets, high vs Tekla EPM.
- **Metering roadmap:** if you want usage-based CAD-conversion or AR pricing later, that depends on building per-tenant metering (currently a non-goal — see scope doc §2).

> *Figures are illustrative planning anchors, not committed list prices. Validate WTP before publishing.*
