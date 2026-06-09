# PCS AR demo piece — how to proceed

Concept: a **two-column drop-on portal**, built for a **live demo**. A welded **stand** (base
plate + 2 columns, each with an erection seat + fin plate) stands flat on its own; **one loose
beam** spans between the columns and **drops onto both seats** — gravity holds it, the webs
self-align to the fins, all 4 holes line up — then it's fixed with **4 bolts** (2 per end), head
and nut both out in the open. ~30 seconds, one spanner, nothing held mid-air. Exported **Y-up**
(glTF) so it stands upright in model-viewer and the iPad AR app.

Files in this folder:

| File | Use |
|------|-----|
| `demo_assembly.ifc` | IFC4/BIM model (Z-up) — hand to a steel detailer / fab shop |
| `demo_assembly.glb` | Mesh (**Y-up**) — **the file the iPad AR app loads** (also in your Downloads) |
| `demo_assembly.stl` | Single watertight mesh — **upload to a 3D-print service** |
| `assembly_preview.png` | Overview + connection close-up |
| `FABRICATION_SUMMARY.md` | Part list + assembly sequence + checks |
| `generate_demo_assembly.py` | Parametric generator; `render.py` makes the preview |

**Envelope:** 580 × 280 × 412 mm (fits a car trunk).
**Mass:** steel **41 kg** · aluminium **14 kg** · 3D-print PLA **~2.3 kg**.
**Kit:** welded stand (base + 2 columns + 2 seats + 2 fins) + **1 loose beam** + **4 M16 bolts**.

## Assemble it on the spot (the demo move)
1. Stand the welded **portal** on the table (flat-based, stable on its own).
2. **Lower the beam** onto the two erection seats — it lands on both, the webs sit beside the fins, and all four holes line up by themselves.
3. Push **2× M16** through each fin + web (4 total) and spin the nuts on — head one side, nut the other, both reachable with one spanner.
4. Point the iPad: the AR wireframe overlays and you verify the bolt holes + the seated beam match the model.

## 1. Pick material + route
- **Aluminium (6061), fab shop** ← recommended: real welded metal, ~14 kg, easy carry.
- **3D-print (PLA/PETG matte, or MJF nylon)**: ~2.3 kg, cheap/fast (pre-split the 580 mm parts if your bed is small — I can do that).
- **Steel (S355)**: ~41 kg, max authenticity, two-person lift.

## 2. Send it out (2–4 weeks)
- **Fab shop:** send `demo_assembly.ifc` + `FABRICATION_SUMMARY.md`. They **weld the stand** (base + 2 columns + 2 seats + 2 fins) and cut the **one loose beam**; you bolt it on at the demo. Bare/matte finish. I can also produce **DXF flat-patterns** for the plates.
- **3D-print service:** upload `demo_assembly.stl`. Matte grey.

## 3. Finish
Bare / matte (raw steel, bead-blasted aluminium, or matte-grey print). No gloss/light paint — it washes out the AR wireframe.

## 4. Run the AR overlay (PCS mobile)
1. Upload `demo_assembly.glb` as a **Model3D** (type *assembly*) in the web app (or `POST /api/models`); mobile streams it from `/api/models/:id/file`.
2. Build/run a **dev client / native build** (Viro AR isn't in Expo Go).
3. Models tab → your model → **AR View**; lock on with **image-target tracking** (a printed marker on the base plate).
4. Toggle the **wireframe** and verify the fin-plate bolt holes line up with the real steel.

### Open knobs (ask)
Add a diagonal brace or a second (lower) beam · widen/raise the portal · DXF flat-patterns ·
pre-split the STL · change section sizes.
