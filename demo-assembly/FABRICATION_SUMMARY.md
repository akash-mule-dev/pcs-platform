# PCS AR Demo - Two-Column Drop-On Portal

A two-column portal built for a **live on-the-spot demo**: a welded STAND (base + 2 columns, each with an erection seat + fin plate) that stands flat on its own, and **one loose beam** that **drops onto both seats** (gravity holds it, the webs self-align to the fins, all 4 holes line up) and is fixed with **4 bolts** (2 per end) whose head and nut are **both in open air** - one spanner, ~30 s, nothing held mid-air, no nuts inside cavities. Exported **Y-up** so it stands upright in model-viewer and the AR app.

- **Files:** `demo_assembly.ifc` (IFC, Z-up) · `demo_assembly.glb` (12 nodes, **Y-up**; AR loads this) · `demo_assembly.stl` (Y-up, print)
- **Bounding box:** 580 x 280 x 412 mm (fits a car trunk)
- **Mass:** steel 40.8 kg · aluminium 14.0 kg · 3D-print PLA ~2.3 kg
- **Parts:** 12 pieces in 6 types; 4x M16; **1 loose part (the beam)**
- **Checks:** stands flat PASS (0.0 mm) · Y-up PASS · fasteners in open air PASS · interference NONE

## Part list

| # | Part | Section | Size (mm) | Qty | Joint | kg |
|---|------|---------|-----------|-----|-------|---:|
| A | Base plate | PL 12 | 580x280x12 | 1 | welded stand | 15.30 |
| B | Columns (x2) | I 150x90 | L=400 | 2 | welded to base | 7.57 |
| C | Erection seats | PL 12 | 120x140x12 | 2 | welded to columns | 1.58 |
| D | Fin plates | PL 10 | 90x120x10 | 2 | welded; 2x Ø18 (M16) | 0.85 |
| E | Beam (loose) | I 150x90 | L=246 | 1 | drops on 2 seats + 4x M16 | 4.66 |
| F | Hex bolts+nuts+washers | M16 | modelled | 4 | 4x M16 | 0.52 |
| | **TOTAL** | | | **12** | | **30.5** |

## Assembly sequence

1. Shop-weld the STAND = base plate + 2 columns + an erection seat & fin plate on each. It stands flat on its own.
2. On the spot (~30 s, one spanner):
    1) Lower the BEAM onto the two erection seats - it lands on both, the webs sit beside the fins, and all 4 holes line up.
    2) Push 2x M16 through each fin + web (4 total) and spin the nuts on (head one side, nut the other, both in the open).
3. Finish bare/matte. QA against the iPad AR green-wireframe overlay.

## Finish

Bare/matte for AR contrast. No gloss/light paint.
