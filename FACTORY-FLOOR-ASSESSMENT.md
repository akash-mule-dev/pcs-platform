# PCS Platform — Factory-Floor Manager's Assessment

**Date:** 2026-06-06
**Lens:** A working floor manager of a ~200-employee, multi-product factory that includes **metal fabrication**, asking: *can I actually run my floor on this?*

This is a capability/fitness review grounded in the code, not a code-quality audit.

---

## Verdict

The platform is **excellent at production execution and labor visibility** and **not yet a full floor-management system**. If my question is *"who is doing what, on which order, against target, right now?"* — it answers that better than most tools, live, on web and the operator's phone. If my question is *"do I have the steel to start this job, is the press brake free, what's my schedule this week, and what did this part cost?"* — the app can't answer those today.

It does what it was scoped to do (production control + real-time per-operator/per-stage time tracking) very well. The gaps below are adjacent domains it doesn't yet cover, plus one metric I wouldn't trust as-is.

---

## Scorecard

| Capability a floor needs | Status | Notes |
|---|---|---|
| Process & routing definition (multi-product, versioned, ordered stages, target times) | 🟢 Strong | Complete; drag-reorder designer |
| Work-order lifecycle & dispatch (status state-machine, priority, due date, line, dependencies, batch ops, kanban) | 🟢 Strong | Solid execution backbone |
| Real-time labor / time tracking (per operator, per stage; idle/break/rework) | 🟢 Strong | The standout; now live on web **and** mobile |
| Live floor visibility ("who's on what") | 🟢 Strong | Dashboard *Live Stage Status*: operator / order / stage / elapsed / station |
| Operator mobile app (assigned work, clock in/out, 3D/AR, offline queue) | 🟢 Strong | Genuinely useful on the floor |
| Quality — inspection capture (pass/fail/warn, defect type/severity, measurements & tolerances, sign-off, defect patterns) | 🟡 Adequate | Logging only — no NCR/CAPA workflow, no real SPC charts |
| Drawings / 3D references (IFC + PDF packages, model viewer) | 🟡 Adequate | Good reference; not version-controlled work instructions |
| Roles & access / audit log / notifications | 🟡 Adequate | Only 4 roles; permissions are code-bound to those names |
| Workforce — skills / certifications | 🔴 Missing | No way to record who is weld-certified, CNC-qualified, etc. |
| Workforce — shifts / rosters / attendance / overtime | 🔴 Missing | Only a 6 PM "shift summary" notification; no shift model |
| Scheduling — finite capacity / time-phased plan / Gantt | 🔴 Missing | You can prioritize & sequence on a board, but can't load-plan |
| **Materials / inventory / BOM** | 🔴 Missing | No raw stock, BOM, consumption, scrap, or shortage checks |
| **Equipment / machines / maintenance** | 🔴 Missing | Stations are labels, not machines; no downtime or PM |
| **Traceability — lot / serial / heat numbers** | 🔴 Missing | Orders are quantity-based only |
| Costing — labor / material | 🔴 Missing | No cost roll-up per order or product |
| OEE (true availability) | 🟠 Misleading | See note below — not a real OEE |

---

## What works great (I'd rely on these daily)

- **I always know who's working on what.** Every operator clocks into a specific stage of a specific work order; the dashboard shows it live (operator, order, stage, elapsed, station), and supervisors can correct entries. This is the hardest part of floor awareness and it's done well.
- **Work flows the way a floor works.** Orders move draft → pending → in-progress → completed with a real state machine, priorities, due dates, line assignment, dependencies between orders, and a kanban view. Batch status/line changes are there for when I'm moving a lot at once.
- **Processes are properly templated per product.** Multi-product, versioned routings with ordered stages and target times — so the same part is built the same way every time, and I can compare actual vs. target by stage.
- **The operator's phone is a real tool**, not an afterthought: assigned work, clock in/out, even a 3D/AR model viewer for assembly reference, with an offline queue for dead zones.
- **Inspection data is captured against the actual geometry** (defects tied to model meshes, with severity, measurements, and tolerances), plus sign-offs and defect-pattern views.

## Gaps that would bite me on a real metal-fab floor

1. **No materials/inventory/BOM — the biggest one.** I can release a work order for a fabricated part with **no check that the steel exists**. There's no bill of materials, no stock of sheet/bar/coil, no material issue/consumption, no scrap/offcut tracking, no WIP. On a metal-fab floor this is central, not optional.
2. **No equipment or maintenance.** Lasers, press brakes, CNC, welders — none are modeled. "Stations" are just names on a line, with no capacity, state, downtime capture, or preventive-maintenance schedule. So I can't see *why* a line stalled or plan around a machine being down.
3. **No real scheduling/capacity planning.** I can prioritize and sequence on a board and set due dates, but there's no finite-capacity or time-phased schedule — nothing tells me I've loaded 60 hours of work onto a 40-hour line this week.
4. **The workforce model is thin for 200 people.** Users have a single role from a fixed set of four (admin/manager/supervisor/operator). There's no skills/certification record (who may weld pressure vessels?), no shift/roster, no attendance or overtime. I can *assign* an operator to a stage, but I can't enforce that they're qualified, or plan shifts.
5. **No traceability.** No lot/heat numbers on material, no serial genealogy on output. For fabrication tied to material certs or any recall scenario, that's a hole.
6. **No costing.** Labor time is captured but never rolled into a cost; no material cost. I can't tell you what an order or a part actually cost to make.
7. **Quality is logging, not a system.** Great for recording inspections, but there's no nonconformance/CAPA workflow and no real SPC control charts (only trend views).

## The OEE caveat (read before trusting the number)

The dashboard shows an **OEE** with Availability / Performance / Quality, which looks like the industry-standard metric — but in the code:

- `Availability = min(1, plannedTime / actualTime)` and `Performance = min(1, plannedTime / actualTime)` — **the same ratio**. Real availability needs downtime / planned-production time, which the system doesn't capture (no downtime, no machine calendar). So Availability here isn't availability.
- Net effect: **OEE ≈ (target/actual)² × inspection-pass-rate**, not the real thing. It will read plausibly and trend, but I'd make wrong calls if I treated it as true OEE.
- Minor: the Quality factor counts *all* quality records, ignoring the date range used for the rest.

I'd relabel this "Labor Efficiency" until real availability (downtime/scheduled-time) exists, or compute a genuine OEE once equipment/downtime is modeled.

---

## If I were prioritizing what to add (for this scenario)

1. **Materials & BOM** — bill of materials per product, raw stock, issue/consumption, scrap, and a shortage check before a work order can be released. (Highest impact for metal fab.)
2. **Equipment & downtime** — promote stations to machines with state and downtime reasons; feed a *real* availability into OEE; add basic preventive-maintenance scheduling.
3. **Skills/certifications on the workforce** — record qualifications and validate stage assignments against them (this also makes the "default role/skill per stage" idea we discussed enforceable).
4. **Capacity/scheduling view** — even a simple per-line load-vs-capacity by week before a full finite scheduler.
5. **Traceability & costing** — lot/heat on materials and serial on output; roll labor (and later material) time into cost.
6. **Fix/relabel OEE** so the headline metric is trustworthy.

---

*Bottom line: a strong production-control and live labor-tracking system — keep leaning on it for that. To "run the whole floor" of a 200-person metal-fab operation, the materials, equipment, scheduling, and traceability layers are the work ahead.*
