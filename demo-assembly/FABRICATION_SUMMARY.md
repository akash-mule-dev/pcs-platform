# PCS AR Demo - Steel Moment-Connection Specimen

Portable raw-steel demonstration piece for the AR QA-overlay app. A W200 column stub with W150 beams bolted through end plates, loaded up with as many distinct fabricated part types as practical so the iPad overlay can show holes, plates and stiffeners lining up between the digital model and the steel.

- **Files:** `demo_assembly.ifc` (IFC4, mm, S355) and `demo_assembly.glb` (23 named part nodes, mm)
- **Bounding box:** 885 W x 228 D x 460 H mm (budget 1000 x 300 x 700) - fits a car trunk
- **Mass:** 76.3 kg calc / 77.0 kg meshed (target 60-80 kg, two-person carry)
- **Parts:** 23 pieces in 15 types; 41 bolt holes (M16=Ø18, M20=Ø22) + 2 Ø80 grip holes
- **Profile types:** IfcArbitraryClosedProfileDef, IfcCircleHollowProfileDef, IfcIShapeProfileDef, IfcLShapeProfileDef, IfcRectangleProfileDef, IfcUShapeProfileDef

## Part list

| # | Part | Profile type | Section | Size (mm) | Qty | Holes | kg/ea | kg total |
|---|------|--------------|---------|-----------|-----|-------|------:|---------:|
| A | Base plate | `IfcRectangleProfileDef` | PL 10 | 700 x 220 x 10 | 1 | 4x Ø22 (M20 anchor) | 11.97 | 11.97 |
| B | Column stub | `IfcIShapeProfileDef` | W200x46 | 203 x 203, L=440 | 1 | - | 19.93 | 19.93 |
| C | Beams (L & R) | `IfcIShapeProfileDef` | W150x24 | 102 x 160, L=300 | 2 | - | 7.12 | 14.23 |
| D | End plates | `IfcRectangleProfileDef` | PL 16 | 150 x 210 x 16 | 2 | 4x Ø22 (M20) | 3.77 | 7.53 |
| E | Column cap plate | `IfcRectangleProfileDef` | PL 10 | 200 x 200 x 10 | 1 | 4x Ø18 (M16) | 3.06 | 3.06 |
| F | Web/continuity stiffeners | `IfcRectangleProfileDef` | PL 8 | 175 x 95 x 8 | 4 | - | 1.04 | 4.18 |
| G | Doubler plate | `IfcRectangleProfileDef` | PL 8 | 180 x 120 x 8 | 1 | 2x Ø18 (M16) | 1.32 | 1.32 |
| H | Gusset plate | `IfcArbitraryClosedProfileDef` | PL 12 (cut) | 200 x 150 x 12 pentagon | 1 | 4x Ø22 (M20) | 2.43 | 2.43 |
| I | Shear tab (fin plate) | `IfcRectangleProfileDef` | PL 8 | 90 x 120 x 8 | 1 | 3x Ø18 (M16) | 0.63 | 0.63 |
| J | Web splice plates | `IfcRectangleProfileDef` | PL 8 | 160 x 110 x 8 | 2 | 4x Ø18 (M16) | 1.04 | 2.08 |
| K | Flange cover plates | `IfcRectangleProfileDef` | PL 8 | 220 x 90 x 8 | 2 | 4x Ø18 (M16) | 1.18 | 2.36 |
| L | Angle brace | `IfcLShapeProfileDef` | L75x75x8 | 75 x 75 x 8, L=200 | 1 | - (welded) | 1.78 | 1.78 |
| M | Tube brace stub (CHS) | `IfcCircleHollowProfileDef` | CHS 88.9 x 5 | Ø88.9 x 5, L=150 | 1 | - (welded) | 1.55 | 1.55 |
| N | Channel stiffener (U) | `IfcUShapeProfileDef` | C75x40 | 75 x 40, L=180 | 1 | - (welded) | 1.22 | 1.22 |
| O | Carry handles | `IfcRectangleProfileDef` | PL 10 | 120 x 150 x 10 | 2 | 1x Ø80 grip | 1.02 | 2.04 |
| | **TOTAL** | | | | **23** | **41 bolt + 2 grip** | | **76.3** |

## Assembly / welding sequence

1. Cut & drill all components (NC).  Burn/drill bolt holes: Ø22 for M20, Ø18 for M16.
    Burn the Ø80 grip holes in the two handle plates.  Cut sections to length:
    column W200x46 L440, beams W150x24 L300, angle L75x75x8 L200, CHS 88.9x5 L150,
    channel C75x40 L180.  Deburr all holes and edges.
2. Set the base plate (PL12 720x230) level on the bench; mark the column footprint.
3. Stand the W200x46 column stub on the base plate, square it both ways, and weld
    all-around with a full fillet (column-to-base is the critical root joint).
4. Fit the 4 continuity/web stiffeners inside the column at the beam top & bottom
    flange levels; weld to web and flanges.  Weld the doubler plate to the web
    panel zone (it lines up between the stiffeners).
5. Weld the end plates (PL16) square to each beam end, full perimeter.
6. Offer the beams up to the column flange faces and bolt through the end plates
    with 4x M20 per side (snug-tight).  This bolted interface is the primary
    AR-QA check - the overlay must show all 8 holes concentric.
7. Weld the cap plate (PL10) to the top of the column.
8. Add the demonstrator parts: weld the shear tab (fin plate) to the upper column
    flange; bolt the two web splice plates across the left beam web (4x M16 each);
    bolt the top & bottom flange cover plates to the right beam (4x M16 each).
9. Build the brace node: weld the gusset plate to the column/beam, then weld the
    L75x75x8 angle brace and the CHS 88.9x5 tube stub to it; weld the C75x40
    channel stiffener to the column.
10. Weld the two carry handles to the base plate, one at each end (grip holes up).
11. Grind/wire-brush all welds.  LEAVE BARE - do not paint or galvanise.
12. QA: confirm dims <= 1000 x 300 x 700 mm, weigh (target 60-80 kg), then verify
    the full bolt-hole pattern against the iPad AR green-wireframe overlay.

## Finish

FINISH:  Leave the physical specimen UNPAINTED / bare raw steel.  A mill-scale or lightly ground steel surface gives the best contrast for the AR app's green wireframe overlay; paint (especially gloss or light colours) reflects and washes out the projection and dulls edge detection.  If flash-rust is a concern for transport, wipe with a thin clear/matte lacquer or light oil - never a pigmented coating.
