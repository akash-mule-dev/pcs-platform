# PCS AR Demo - End-Plate Braced Portal Frame

A braced portal frame you **assemble from individual parts**. Base + columns are one **welded frame**; the top beam, cross-beam and brace **bolt on** via **end-plate connections** - every bolt passes through two flat plates with head and nut in the open (nut in the open column cavity), so **no fastener is buried inside a rolled section** (checked by an exact point-in-mesh test). No pipe; sits dead flat.

- **Files:** `demo_assembly.ifc` · `demo_assembly.glb` (28 part nodes; AR loads this) · `demo_assembly.stl` (print)
- **Bounding box:** 560 x 320 x 540 mm (fits a car trunk)
- **Mass:** steel 62.6 kg · aluminium 21.5 kg · 3D-print PLA ~3.5 kg
- **Parts:** 28 pieces in 11 types; 10x M16 fasteners
- **Checks:** flat base PASS (0.0 mm) · bolts external PASS · interference NONE

## Part list

| # | Part | Section | Size (mm) | Qty | Joint | kg |
|---|------|---------|-----------|-----|-------|---:|
| A | Base plate | PL 10 | 560x320x10 | 1 | welded frame foot | 14.07 |
| B | Columns I120 | I 120x70 | L=480 | 2 | welded to feet | 6.18 |
| C | Column foot plates | PL 12 | 150x180x12 | 2 | welded to base | 2.54 |
| D | Column conn. plates | PL 14 | 130x200x14 | 4 | end-plate bolted | 2.86 |
| E | Brace gussets | PL 10 | ~285x90x10 | 2 | bolted (1x M16) | 2.01 |
| F | Top portal beam | I 120x70 | L=306 | 1 | end-plate bolted | 3.94 |
| G | Beam end plates | PL 12 | 130x200x12 | 2 | 4x M16 total | 2.45 |
| H | Cross-beam | I 100x64 | L=306 | 1 | end-plate bolted | 3.47 |
| I | Cross end plates | PL 12 | 120x164x12 | 2 | 4x M16 total | 1.85 |
| J | Diagonal brace | FB 80x10 | L=326 | 1 | bolted (2x M16) | 2.04 |
| K | Hex bolts+nuts+washers | M16 | modelled | 10 | 10x M16 | 1.30 |
| | **TOTAL** | | | **28** | | **42.7** |

## Assembly sequence

1. Shop-weld the FRAME = base + both columns (on foot plates) + the 4 column connection plates + the 2 brace gussets.
2. Shop-weld an END PLATE onto each end of the top beam and the cross-beam.
3. Demo assembly (all bolted, all bolts external):
    1) Bolt the TOP BEAM end plates to the column connection plates (2x M16 each end, above & below the beam).
    2) Same for the CROSS-BEAM (2x M16 each end).
    3) Bolt the DIAGONAL BRACE to the two gusset tips (1x M16 each end).
4. Finish bare/matte. QA against the iPad AR green-wireframe overlay.

## Finish

Bare/matte for AR contrast. No gloss/light paint.
