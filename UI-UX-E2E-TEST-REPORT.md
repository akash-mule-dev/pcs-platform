# E2E UI/UX Test Report — Project Creation → Work Order → Quality → Shipment

**Date:** 2026-06-11 · **Tester:** Claude (driving the real UI in Chrome)
**Environment:** Web portal `localhost:4200`, mobile app (Expo web) `localhost:8081`, backend `localhost:3000`, Neon dev DB.
**Test model:** `Project model.ifc` (NPL) — 460 nodes: 4 groups, 68 assemblies, 388 parts.

---

## 1. What was tested and the result

| # | Step | Result |
|---|------|--------|
| 1 | New Project wizard (details → IFC upload → review) | ✅ Works. 460 nodes imported, GLB converted & linked, 3D preview renders |
| 2 | Project created with no CAD (skip upload) | ✅ Works — order auto-creates a root assembly so qty tracking still functions |
| 3 | Work order: qty **5**, one-click **standard process** (Cut→Fit→Weld→QC→Paint) | ✅ Works after a bug fix made during testing (see Bugs #1) |
| 4 | Board: quantity stepper, "All", live column movement, order status pill | ✅ Works — counts roll up (1/5 → In progress), item moves columns |
| 5 | Live reflection: assembly status / % complete / project header | ✅ D1001 → `in_progress` 60% → `ready_to_ship` 100% → `shipped` |
| 6 | **Quality gate**: NCR raised on D1001 → complete QC stage | ✅ Blocked with red banner; both "All" and stepper modes blocked |
| 7 | NCR disposition in Quality → NCR/CAPA (closed + rework) | ✅ Works; QC stage then completes |
| 8 | **Shipping gate**: add incomplete item to a load | ✅ Rejected: "…its production stages are not all complete yet." |
| 9 | Shipping: create load → add ready item → mark shipped | ✅ Node `shipped`, qtyShipped=1; re-add blocked ("already fully shipped") |
| 10 | Mobile app: Projects → NPL → ORD-2026-0004 board | ✅ Stage chips + counts match web exactly (incl. "Done 1") |

**Bottom line: the end-to-end flow works on web and mobile, including both enforcement gates.**

---

## 2. Bugs found (1 fixed live, others open)

1. **[FIXED during test] 500 on work-order creation.** WO numbers were derived from `count()`; after any deletion the count lags the highest number → unique-constraint collision → "Internal server error", and the batch path had no retry. Fixed in `production-order.service.ts`: numbering now derives from the MAX existing number with a 23505 retry (orders + WOs). **Same flawed count-based pattern still exists in `WorkOrdersService.create` and `WorkOrderGenService` — recommend the same fix there.**
2. **Order partially created behind the 500.** The failed request had already created the order + 183 WOs; the UI said "Internal server error" with no hint. A second click would have duplicated the order. Recommend: wrap order creation in a transaction, or make the error handler check/report partial success.
3. **Import wizard blocks on 3D conversion.** With no Redis the GLB conversion runs inline, so the import POST is held open for minutes while the dialog shows only "Extracting assembly structure…" (the tree was actually saved after ~1 min). Recommend: return after tree persist and convert in the background (the resolve-models poller already exists), or at least change the label to "Converting 3D model…" with a "this can take a few minutes" hint.

## 3. UX findings, in priority order

**P1 — operator-facing friction**
1. **Stepper clicks are silently dropped while a request is in flight.** Each +/− PATCH takes 1–2s (remote DB); rapid taps are swallowed with no feedback. Operators WILL lose counts. Fix: optimistic updates + request queueing, or disable with a spinner on the card.
2. **Board performance at real scale.** 183 items × 5 stages = 915 cards rendered at once; the renderer froze repeatedly during testing (10–30s). Needs column virtualization/pagination ("show 20, load more"), and a search/filter box on the board.
3. **Identical marks are indistinguishable.** Two "D1001" cards look the same everywhere (board, tree). Add a secondary identifier (GUID suffix, instance #1/#2) or group repeated marks into one card with an instance count.
4. **No item search** on the board or the assemblies tree (460 nodes = endless scrolling).

**P2 — flow clarity**
5. **Quality actions require leaving the order.** Order → Quality tab says "go to the Assemblies tab" (a different context). Inspections/NCRs should be recordable from the order's Quality tab or directly from a board card (e.g. a card menu: "Record check / Raise NCR").
6. **Gate message uses internal WO numbers.** "Quality gate: WO-2026-0027 has 1 open NCR…" — operators think in marks; say "D1001 has 1 open NCR…".
7. **"Work orders" terminology is overloaded.** Header stat says "183 WORK ORDERS" (internal per-assembly WOs) while the Work Orders tab lists 1 (the production order). Rename the stat (e.g. "Items in production") or count orders.
8. **Stale data after actions.** Header stats stay 0 after creating an order; the Shipping tab's "Ready to ship" list misses items completed since page load (showed 0 until reload). The store should refresh on order creation/stage changes (or poll like the board does).
9. **NCR list has no project/part context** — only number/title/severity/status. Add project + mark columns and a link back to the item.

**P3 — polish**
10. Empty project Overview pushes IFC import only; should also offer "create a work order without a model" (the no-CAD path works!).
11. Assemblies tree shows "Undefined > Undefined > Undefined" for unnamed IFC spatial levels; fall back to "Site / Building / Level" or collapse unnamed wrappers.
12. Total weight reads 0 t for the NPL model — weight quantities didn't map from this IFC; worth checking the Qto extraction.
13. "Ready to ship" list still shows an item already allocated to an open load (backend rejects re-add, but the list should mark it "allocated").
14. Stages can be completed out of order with no warning (by design, but consider a subtle "previous stage incomplete" hint).
15. Wizard "Skip" creates the project instantly, skipping the Review step — efficient but slightly surprising.

## 4. What felt good

- The wizard is clean; skippable IFC step with clear copy.
- One-click "Use standard process" removes the biggest onboarding hurdle.
- Board → tree → 3D → shipping all reflect one consistent status model; the order status pill updates live as counts move.
- Gates fail with **clear, human error messages** (not silent failures): quality and shipping enforcement both read well.
- Mobile and web show identical numbers — sync is solid.
- NCR disposition flow (status/disposition/note + CAPA) is simple and worked first try.

## 5. Fix round (2026-06-11, same day) — status of every finding

All items below were implemented; ✅ = also re-verified live in the browser before the dev servers went down.

**Bugs**
- ✅ Count-based numbering → MAX-based + retry everywhere: production orders, classic WO create, project WO-gen, NCR numbers.
- ✔ Order creation is now fully transactional (order + WOs + stages all-or-nothing; number-race retries the whole transaction).
- ✔ IFC import no longer blocks on GLB conversion (runs in background; resolve-models polling picks it up) **and** tree persistence is batched (was 2 round trips × node — minutes on a real model; now chunked level-by-level saves).

**P1**
- ✅ Stepper is optimistic + debounced: taps update the card instantly, one absolute update is sent; per-card spinner; errors revert and show a banner. Rapid taps verified (2/5 instantly, persisted correctly).
- ✅ Board scale: search box + per-column paging ("Show more", 30/page) instead of rendering all 915 cards.
- ✅ Duplicate marks disambiguated ("D1001 #1", "D1001 #2") on the board.
- ✅ Assemblies tree search (flat results across 460 nodes, with profile matching).

**P2**
- ✅ "Record a check" panel on the order's Quality tab (search item → Pass/Warning/Fail → Raise NCR) — no context switch.
- ✔ Gate messages now use the part mark ("D1001 has 1 open NCR…") instead of internal WO numbers.
- ✅ Terminology: header shows "Work orders" (customer runs) and "Items in production" (per-assembly WOs) separately; orders tab badge counts orders.
- ✅ Stale data: store refreshes orders/progress/nodes after order creation; Shipping tab refreshes nodes/quality/progress on entry.
- ✅ NCR list shows Project + Item columns (backend enriches the rows).

**P3**
- ✔ Overview empty state offers BOTH paths (import IFC / create a work order without a model).
- ✅ "Undefined" IFC groups display as "Unnamed group" (or Site/Building/Level from the IFC class).
- ✔ Ready-to-ship list marks items already on an open load ("On a load", Add disabled, qty accounts for allocations).
- ✔ Out-of-sequence chip on board cards — refined to flag only real anomalies (progress on a later stage while an earlier one is open).
- ✖ Not addressed: IFC weight quantities reading 0 t (needs extractor investigation); wizard "Skip creates instantly" (left as-is, intentional).

**Note:** the frontend dev server stopped picking up file changes near the end (and both dev servers then went down) — after restarting `ng serve`, the final board tweak (out-of-sequence refinement) compiles in; everything else was already served and verified.

## 6. Test data left in the system

- **NPL Demo Project** (NPL-001) with ORD-2026-0004 (qty 5): D1001 fully produced & shipped on LOAD-1 (BlueDart → NPL Site, Pune); NCR-2026-0002 closed (rework). Kept for your inspection.
- Temporary projects "Demo Stand — E2E Test" and "E2E Flow Test…" were deleted.
- Note: the backend fix in `production-order.service.ts` is **uncommitted**.
