# PCS AR demo piece — how to proceed

Concept: **bolted end-plate braced portal frame** (no pipe). The base + columns are one **welded
frame**; the top beam, cross-beam and diagonal brace **bolt on** via proper **end-plate
connections** — every bolt goes through two flat plates with the head and nut in the open (the
nut lands in the open column cavity), so **no fastener is buried inside a beam**. It sits dead
flat. The generator verifies all three automatically (flat base, bolts-not-in-steel via an exact
point-in-mesh test, no interference).

Files in this folder:

| File | Use |
|------|-----|
| `demo_assembly.ifc` | IFC4/BIM model — hand to a steel detailer / fab shop |
| `demo_assembly.glb` | Mesh — **the file the iPad AR app loads** (also in your Downloads) |
| `demo_assembly.stl` | Single watertight mesh — **upload to a 3D-print service** |
| `assembly_preview.png` | Overview + connection close-ups |
| `FABRICATION_SUMMARY.md` | Part list + bolt-together sequence + checks |
| `generate_demo_assembly.py` | Parametric generator; `render.py` makes the preview |

**Envelope:** 560 × 320 × 540 mm (clears a car trunk).
**Mass:** steel **63 kg** · aluminium **21 kg** · 3D-print PLA **~3.5 kg**.
**Kit:** 18 fabricated parts + **10 bolts** (M16). Welded frame + three bolt-on members.

## Connection cases (what the AR overlay checks)
End-plate beam-to-column at the top beam (2 M16 each end) and the cross-beam (2 M16 each end),
and the diagonal brace bolted to cantilevered gusset tips (1 M16 each end). The base, columns,
column connection plates and gussets are welded.

## 1. Pick material + route
- **Aluminium (6061), fab shop** ← recommended: real welded metal, ~21 kg, easy one-hand carry.
- **3D-print (PLA/PETG matte, or MJF nylon)**: ~3.5 kg; split the 560 mm length into bonded sections or use a large-format/MJF bureau.
- **Steel (S355)**: ~63 kg, max authenticity, two-person lift.

## 2. Send it out (2–4 weeks)
- **Fab shop:** send `demo_assembly.ifc` + `FABRICATION_SUMMARY.md`. They **weld the frame** (base + columns + foot plates + the 4 column connection plates + the 2 gussets) and weld an **end plate** onto each beam end; then you **bolt the beams and brace on** at the demo. Bare/matte finish. I can also generate **DXF flat-patterns** for the plates.
- **3D-print service:** upload `demo_assembly.stl`. Matte grey; pre-split for the bed (I can do that).

## 3. Finish
Bare / matte (raw steel, bead-blasted aluminium, or matte-grey print). No gloss/light paint — it washes out the AR wireframe.

## 4. Run the AR overlay (PCS mobile)
1. Upload `demo_assembly.glb` as a **Model3D** (type *assembly*) in the web app (or `POST /api/models`); mobile streams it from `/api/models/:id/file`.
2. Build/run a **dev client / native build** (Viro AR isn't in Expo Go).
3. Models tab → your model → **AR View**.
4. Lock it on with **image-target tracking** — a printed marker on the base plate gives repeatable registration.
5. Toggle the **wireframe**, align to the steel, and walk the joints: the end-plate bolts at each beam-to-column connection should sit concentric with the real holes.

### Open knobs (ask)
DXF flat-patterns for laser cutting · pre-split the STL for printing · trim the steel weight ·
add a third bolt per beam end · tune any dimension.
