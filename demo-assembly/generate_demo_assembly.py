#!/usr/bin/env python3
"""
PCS AR Demo - portable steel beam-to-column moment-connection specimen.

Generates:
  demo_assembly.ifc   (IFC4, millimetres, S355 steel)
  demo_assembly.glb   (mm-scaled triangulated mesh, one named node per part)
and prints a full fabrication summary (part list + weld/assembly sequence).

Design intent
-------------
A car-trunk-portable raw-steel demo piece packed with as many distinct
fabricated part types as practical, so an AR app can overlay a green
wireframe and show bolt holes / plates / stiffeners lining up between the
digital model and the physical steel. It is a DEMONSTRATION SPECIMEN that
collects many connection part types onto one column - not a single
code-checked structural connection.

Units / scaling
---------------
The IFC is authored in millimetres. ifcopenshell's geometry iterator returns
metres, so GLB vertices are multiplied by 1000 to express the model in mm.

Coordinate frame (world): X = width (1000 mm budget), Y = depth (300 mm),
Z = height (700 mm). Origin at the centre of the base-plate underside.
"""
import math, time
import numpy as np
import ifcopenshell, ifcopenshell.guid
import ifcopenshell.geom as geom
import trimesh

DENS = 7.85e-6          # kg/mm^3  (S355, 7850 kg/m^3)
OUT_IFC = "demo_assembly.ifc"
OUT_GLB = "demo_assembly.glb"

# ----------------------------------------------------------------------------
# cross-section area helpers (mm^2). Fillet radii are ignored, so reported
# masses are a few % conservative (low) vs the meshed solid.
# ----------------------------------------------------------------------------
def a_rect(x, y):          return x * y
def a_ishape(b, h, tw, tf):return 2 * b * tf + (h - 2 * tf) * tw
def a_lshape(d, w, t):     return d * t + (w - t) * t
def a_ushape(h, b, tw, tf):return h * tw + 2 * (b - tw) * tf
def a_chs(r_out, t):       return math.pi * (r_out ** 2 - (r_out - t) ** 2)
def a_poly(pts):
    s = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]; x2, y2 = pts[(i + 1) % len(pts)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0

# ----------------------------------------------------------------------------
# IFC file + project skeleton
# ----------------------------------------------------------------------------
f = ifcopenshell.file(schema="IFC4")
person = f.create_entity("IfcPerson", FamilyName="Mule", GivenName="Akash")
org    = f.create_entity("IfcOrganization", Name="Eterio")
p_o    = f.create_entity("IfcPersonAndOrganization", ThePerson=person, TheOrganization=org)
appn   = f.create_entity("IfcApplication", ApplicationDeveloper=org, Version="1.0",
                         ApplicationFullName="PCS AR Demo Assembly Generator",
                         ApplicationIdentifier="PCS-DAG")
OH = f.create_entity("IfcOwnerHistory", OwningUser=p_o, OwningApplication=appn,
                     ChangeAction="ADDED", CreationDate=int(time.time()))

u_len = f.create_entity("IfcSIUnit", UnitType="LENGTHUNIT", Prefix="MILLI", Name="METRE")
u_ang = f.create_entity("IfcSIUnit", UnitType="PLANEANGLEUNIT", Name="RADIAN")
units = f.create_entity("IfcUnitAssignment", Units=[u_len, u_ang])

def pt(c):  return f.create_entity("IfcCartesianPoint", Coordinates=[float(x) for x in c])
def dr(c):  return f.create_entity("IfcDirection", DirectionRatios=[float(x) for x in c])
def a2p3(loc=(0, 0, 0), axis=None, ref=None):
    kw = {"Location": pt(loc)}
    if axis is not None: kw["Axis"] = dr(axis)
    if ref  is not None: kw["RefDirection"] = dr(ref)
    return f.create_entity("IfcAxis2Placement3D", **kw)

ctx  = f.create_entity("IfcGeometricRepresentationContext", ContextType="Model",
                       CoordinateSpaceDimension=3, Precision=1e-5, WorldCoordinateSystem=a2p3())
body = f.create_entity("IfcGeometricRepresentationSubContext", ContextIdentifier="Body",
                       ContextType="Model", ParentContext=ctx, TargetView="MODEL_VIEW")

proj = f.create_entity("IfcProject", GlobalId=ifcopenshell.guid.new(), OwnerHistory=OH,
                       Name="PCS AR Demo - Steel Moment-Connection Specimen",
                       RepresentationContexts=[ctx], UnitsInContext=units)
site = f.create_entity("IfcSite", GlobalId=ifcopenshell.guid.new(), OwnerHistory=OH, Name="Demo Site",
                       ObjectPlacement=f.create_entity("IfcLocalPlacement", RelativePlacement=a2p3()),
                       CompositionType="ELEMENT")
bldg = f.create_entity("IfcBuilding", GlobalId=ifcopenshell.guid.new(), OwnerHistory=OH, Name="Demo Rig",
                       ObjectPlacement=f.create_entity("IfcLocalPlacement",
                           PlacementRelTo=site.ObjectPlacement, RelativePlacement=a2p3()),
                       CompositionType="ELEMENT")
storey = f.create_entity("IfcBuildingStorey", GlobalId=ifcopenshell.guid.new(), OwnerHistory=OH,
                         Name="Specimen",
                         ObjectPlacement=f.create_entity("IfcLocalPlacement",
                             PlacementRelTo=bldg.ObjectPlacement, RelativePlacement=a2p3()),
                         CompositionType="ELEMENT")
f.create_entity("IfcRelAggregates", GlobalId=ifcopenshell.guid.new(), OwnerHistory=OH,
                RelatingObject=proj, RelatedObjects=[site])
f.create_entity("IfcRelAggregates", GlobalId=ifcopenshell.guid.new(), OwnerHistory=OH,
                RelatingObject=site, RelatedObjects=[bldg])
f.create_entity("IfcRelAggregates", GlobalId=ifcopenshell.guid.new(), OwnerHistory=OH,
                RelatingObject=bldg, RelatedObjects=[storey])
STOREY_PL = storey.ObjectPlacement
ZL = dr((0, 0, 1))      # local extrude direction

elements = []           # all IfcElement instances (for material + spatial rels)
summary  = []           # one row per part group

def _solid(profile, depth):
    return f.create_entity("IfcExtrudedAreaSolid", SweptArea=profile, Position=a2p3(),
                           ExtrudedDirection=ZL, Depth=float(depth))

def make_element(name, ifc_class, predef, profile, depth, loc, axis, ref, holes):
    """Build one element: extruded profile, optional CSG holes, placement."""
    item = _solid(profile, depth); rtype = "SweptSolid"
    for (hx, hy, d) in holes:                       # subtract a cylinder per hole
        circ = f.create_entity("IfcCircleProfileDef", ProfileType="AREA", Radius=float(d) / 2.0)
        cyl  = f.create_entity("IfcExtrudedAreaSolid", SweptArea=circ,
                               Position=a2p3((hx, hy, -2.0)), ExtrudedDirection=ZL,
                               Depth=float(depth) + 4.0)
        item = f.create_entity("IfcBooleanResult", Operator="DIFFERENCE",
                               FirstOperand=item, SecondOperand=cyl)
        rtype = "CSG"
    rep = f.create_entity("IfcShapeRepresentation", ContextOfItems=body,
                          RepresentationIdentifier="Body", RepresentationType=rtype, Items=[item])
    pds = f.create_entity("IfcProductDefinitionShape", Representations=[rep])
    pl  = f.create_entity("IfcLocalPlacement", PlacementRelTo=STOREY_PL,
                          RelativePlacement=a2p3(loc, axis, ref))
    kw = dict(GlobalId=ifcopenshell.guid.new(), OwnerHistory=OH, Name=name,
              ObjectPlacement=pl, Representation=pds)
    el = None
    if predef is not None:                      # set PredefinedType only if schema-valid
        try:
            el = f.create_entity(ifc_class, PredefinedType=predef, **kw)
        except RuntimeError:
            el = None
    if el is None:
        el = f.create_entity(ifc_class, **kw)
    elements.append(el)
    hv = sum(math.pi / 4.0 * d * d * depth for (_, _, d) in holes)   # removed hole volume
    return el, hv

def add(group, ptype, section, dims, hole_label, area, depth, ifc_class, predef, profile,
        placements, grip=0):
    masses = []; nh = 0
    for (nm, loc, axis, ref, holes) in placements:
        el, hv = make_element(nm, ifc_class, predef, profile, depth, loc, axis, ref, holes)
        masses.append((area * depth - hv) * DENS); nh = len(holes)
    summary.append(dict(group=group, ptype=ptype, section=section, dims=dims, qty=len(placements),
                        holes_each=nh, hole_label=hole_label, grip_each=grip,
                        mass_each=masses[0], mass_total=sum(masses)))

# ----------------------------------------------------------------------------
# key dimensions (mm)
# ----------------------------------------------------------------------------
BZ      = 10.0          # base-plate thickness / column base level
LCOL    = 440.0         # column stub length
BCZ     = 250.0         # beam centre-line height
CF      = 101.5         # W200 half depth -> column flange face at X = +/-101.5
EPT     = 16.0          # end-plate thickness

# 1) BASE PLATE -------------------------------------------------------------
pr = f.create_entity("IfcRectangleProfileDef", ProfileType="AREA",
                     ProfileName="PL10-700x220", XDim=700.0, YDim=220.0)
add("Base plate", "IfcRectangleProfileDef", "PL 10", "700 x 220 x 10",
    "4x Ø22 (M20 anchor)", a_rect(700, 220), 10.0, "IfcPlate", "SHEET", pr,
    [("Base plate PL10-700x220", (0, 0, 0), (0, 0, 1), (1, 0, 0),
      [(300, 85, 22), (-300, 85, 22), (300, -85, 22), (-300, -85, 22)])])

# 2) COLUMN STUB ------------------------------------------------------------
pr = f.create_entity("IfcIShapeProfileDef", ProfileType="AREA", ProfileName="W200x46",
                     OverallWidth=203.0, OverallDepth=203.0, WebThickness=7.2,
                     FlangeThickness=11.0, FilletRadius=10.0)
add("Column stub", "IfcIShapeProfileDef", "W200x46", "203 x 203, L=440", "-",
    a_ishape(203, 203, 7.2, 11.0), LCOL, "IfcColumn", "COLUMN", pr,
    [("Column W200x46", (0, 0, BZ), (0, 0, 1), (0, 1, 0), [])])

# 3) BEAMS (both sides) -----------------------------------------------------
pr = f.create_entity("IfcIShapeProfileDef", ProfileType="AREA", ProfileName="W150x24",
                     OverallWidth=102.0, OverallDepth=160.0, WebThickness=6.6,
                     FlangeThickness=10.3, FilletRadius=8.0)
add("Beams (L & R)", "IfcIShapeProfileDef", "W150x24", "102 x 160, L=300", "-",
    a_ishape(102, 160, 6.6, 10.3), 300.0, "IfcBeam", "BEAM", pr,
    [("Left beam W150x24",  (-(CF + EPT), 0, BCZ), (-1, 0, 0), (0, 1, 0), []),
     ("Right beam W150x24", ( (CF + EPT), 0, BCZ), ( 1, 0, 0), (0, 1, 0), [])])

# 4) END PLATES -------------------------------------------------------------
pr = f.create_entity("IfcRectangleProfileDef", ProfileType="AREA",
                     ProfileName="PL16-150x210", XDim=150.0, YDim=210.0)
ep_holes = [(55, 70, 22), (-55, 70, 22), (55, -70, 22), (-55, -70, 22)]
add("End plates", "IfcRectangleProfileDef", "PL 16", "150 x 210 x 16", "4x Ø22 (M20)",
    a_rect(150, 210), EPT, "IfcPlate", "SHEET", pr,
    [("Right end plate PL16", ( CF, 0, BCZ), ( 1, 0, 0), (0, 1, 0), ep_holes),
     ("Left end plate PL16",  (-CF, 0, BCZ), (-1, 0, 0), (0, 1, 0), ep_holes)])

# 5) COLUMN CAP PLATE -------------------------------------------------------
pr = f.create_entity("IfcRectangleProfileDef", ProfileType="AREA",
                     ProfileName="PL10-200x200", XDim=200.0, YDim=200.0)
add("Column cap plate", "IfcRectangleProfileDef", "PL 10", "200 x 200 x 10", "4x Ø18 (M16)",
    a_rect(200, 200), 10.0, "IfcPlate", "SHEET", pr,
    [("Cap plate PL10", (0, 0, BZ + LCOL), (0, 0, 1), (1, 0, 0),
      [(70, 70, 18), (-70, 70, 18), (70, -70, 18), (-70, -70, 18)])])

# 6) CONTINUITY / WEB STIFFENERS (x4) --------------------------------------
pr = f.create_entity("IfcRectangleProfileDef", ProfileType="AREA",
                     ProfileName="PL8-175x95", XDim=175.0, YDim=95.0)
st = []
for yc in (52.0, -52.0):
    for lvl in (BCZ + 70.0, BCZ - 70.0):
        st.append((f"Continuity stiffener PL8 (y={yc:+.0f},z={lvl:.0f})",
                   (0, yc, lvl - 4.0), (0, 0, 1), (1, 0, 0), []))
add("Web/continuity stiffeners", "IfcRectangleProfileDef", "PL 8", "175 x 95 x 8", "-",
    a_rect(175, 95), 8.0, "IfcPlate", "SHEET", pr, st)

# 7) DOUBLER PLATE (column web panel zone) ---------------------------------
pr = f.create_entity("IfcRectangleProfileDef", ProfileType="AREA",
                     ProfileName="PL8-180x120", XDim=180.0, YDim=120.0)
add("Doubler plate", "IfcRectangleProfileDef", "PL 8", "180 x 120 x 8", "2x Ø18 (M16)",
    a_rect(180, 120), 8.0, "IfcPlate", "SHEET", pr,
    [("Doubler plate PL8", (0, 3.6, BCZ), (0, 1, 0), (1, 0, 0),
      [(0, 60, 18), (0, -60, 18)])])

# 8) GUSSET PLATE (arbitrary polygon) --------------------------------------
gpts = [(0, 0), (200, 0), (200, 90), (110, 150), (0, 150)]
gline = f.create_entity("IfcPolyline",
        Points=[f.create_entity("IfcCartesianPoint", Coordinates=[float(x), float(y)])
                for (x, y) in gpts + [gpts[0]]])
pr = f.create_entity("IfcArbitraryClosedProfileDef", ProfileType="AREA",
                     ProfileName="GUSSET PL12", OuterCurve=gline)
add("Gusset plate", "IfcArbitraryClosedProfileDef", "PL 12 (cut)", "200 x 150 x 12 pentagon",
    "4x Ø22 (M20)", a_poly(gpts), 12.0, "IfcPlate", "SHEET", pr,
    [("Gusset plate PL12", (40, -6, 175), (0, 1, 0), (1, 0, 0),
      [(50, 45, 22), (150, 45, 22), (50, 110, 22), (150, 110, 22)])])

# 9) SHEAR TAB / FIN PLATE --------------------------------------------------
pr = f.create_entity("IfcRectangleProfileDef", ProfileType="AREA",
                     ProfileName="PL8-90x120", XDim=90.0, YDim=120.0)
add("Shear tab (fin plate)", "IfcRectangleProfileDef", "PL 8", "90 x 120 x 8", "3x Ø18 (M16)",
    a_rect(90, 120), 8.0, "IfcPlate", "SHEET", pr,
    [("Shear tab PL8", (CF + 45.0, -4.0, 390.0), (0, 1, 0), (1, 0, 0),
      [(0, 40, 18), (0, 0, 18), (0, -40, 18)])])

# 10) BEAM-WEB SPLICE PLATES (x2) ------------------------------------------
pr = f.create_entity("IfcRectangleProfileDef", ProfileType="AREA",
                     ProfileName="PL8-160x110", XDim=160.0, YDim=110.0)
sp_holes = [(55, 30, 18), (-55, 30, 18), (55, -30, 18), (-55, -30, 18)]
add("Web splice plates", "IfcRectangleProfileDef", "PL 8", "160 x 110 x 8", "4x Ø18 (M16)",
    a_rect(160, 110), 8.0, "IfcPlate", "SHEET", pr,
    [("Splice plate front PL8", (-280, 3.3, BCZ),   (0, 1, 0), (1, 0, 0), sp_holes),
     ("Splice plate back PL8",  (-280, -11.3, BCZ), (0, 1, 0), (1, 0, 0), sp_holes)])

# 11) FLANGE COVER PLATES (x2) ---------------------------------------------
pr = f.create_entity("IfcRectangleProfileDef", ProfileType="AREA",
                     ProfileName="PL8-220x90", XDim=220.0, YDim=90.0)
cv_holes = [(85, 28, 18), (-85, 28, 18), (85, -28, 18), (-85, -28, 18)]
add("Flange cover plates", "IfcRectangleProfileDef", "PL 8", "220 x 90 x 8", "4x Ø18 (M16)",
    a_rect(220, 90), 8.0, "IfcPlate", "SHEET", pr,
    [("Top cover plate PL8",    (250, 0, BCZ + 80.0), (0, 0, 1),  (1, 0, 0), cv_holes),
     ("Bottom cover plate PL8", (250, 0, BCZ - 80.0), (0, 0, -1), (1, 0, 0), cv_holes)])

# 12) ANGLE BRACE (L-section) ----------------------------------------------
pr = f.create_entity("IfcLShapeProfileDef", ProfileType="AREA", ProfileName="L75x75x8",
                     Depth=75.0, Width=75.0, Thickness=8.0, FilletRadius=8.0)
r2 = math.sqrt(0.5)
add("Angle brace", "IfcLShapeProfileDef", "L75x75x8", "75 x 75 x 8, L=200", "- (welded)",
    a_lshape(75, 75, 8), 200.0, "IfcMember", "BRACE", pr,
    [("Angle brace L75x75x8", (300, 0, 170), (r2, 0, -r2), (r2, 0, r2), [])])

# 13) TUBE BRACE STUB (circular hollow section) ----------------------------
pr = f.create_entity("IfcCircleHollowProfileDef", ProfileType="AREA",
                     ProfileName="CHS88.9x5", Radius=44.45, WallThickness=5.0)
add("Tube brace stub (CHS)", "IfcCircleHollowProfileDef", "CHS 88.9 x 5", "Ø88.9 x 5, L=150",
    "- (welded)", a_chs(44.45, 5.0), 150.0, "IfcMember", "BRACE", pr,
    [("Tube brace stub CHS88.9x5", (-130, 0, 200), (-r2, 0, r2), (0, 1, 0), [])])

# 14) CHANNEL STIFFENER (U-section) ----------------------------------------
pr = f.create_entity("IfcUShapeProfileDef", ProfileType="AREA", ProfileName="C75x40",
                     Depth=75.0, FlangeWidth=40.0, WebThickness=5.0,
                     FlangeThickness=7.0, FilletRadius=8.0)
add("Channel stiffener (U)", "IfcUShapeProfileDef", "C75x40", "75 x 40, L=180", "- (welded)",
    a_ushape(75, 40, 5, 7), 180.0, "IfcMember", "MEMBER", pr,
    [("Channel stiffener C75x40", (0, -80, BCZ - 90.0), (0, 0, 1), (1, 0, 0), [])])

# 15) CARRY HANDLES (x2) with grip holes -----------------------------------
pr = f.create_entity("IfcRectangleProfileDef", ProfileType="AREA",
                     ProfileName="PL10-120x150", XDim=120.0, YDim=150.0)
add("Carry handles", "IfcRectangleProfileDef", "PL 10", "120 x 150 x 10", "1x Ø80 grip",
    a_rect(120, 150), 10.0, "IfcPlate", "SHEET", pr,
    [("Carry handle R PL10", ( 300, 0, BZ + 75.0), (1, 0, 0), (0, 1, 0), [(0, 45, 80)]),
     ("Carry handle L PL10", (-300, 0, BZ + 75.0), (1, 0, 0), (0, 1, 0), [(0, 45, 80)])],
    grip=1)

# ----------------------------------------------------------------------------
# material (S355) + spatial containment, then write IFC
# ----------------------------------------------------------------------------
mat = f.create_entity("IfcMaterial", Name="S355", Category="steel",
                      Description="EN 10025-2 S355JR structural steel")
f.create_entity("IfcRelAssociatesMaterial", GlobalId=ifcopenshell.guid.new(), OwnerHistory=OH,
                Name="S355 steel", RelatedObjects=elements, RelatingMaterial=mat)
f.create_entity("IfcRelContainedInSpatialStructure", GlobalId=ifcopenshell.guid.new(),
                OwnerHistory=OH, Name="Specimen parts",
                RelatingStructure=storey, RelatedElements=elements)
f.write(OUT_IFC)

# ----------------------------------------------------------------------------
# IFC -> GLB via geometry iterator (+world coords) and trimesh.
# Vertices x1000 to convert the iterator's metres back to millimetres.
# ----------------------------------------------------------------------------
s = geom.settings(); s.set(s.USE_WORLD_COORDS, True)
it = geom.iterator(s, f)
scene = trimesh.Scene()
mesh_mass = 0.0; bmin = bmax = None; nodes = 0
assert it.initialize(), "geometry iterator failed to initialize"
while True:
    sh = it.get(); g = sh.geometry
    v = np.asarray(g.verts, dtype=float).reshape(-1, 3) * 1000.0
    fc = np.asarray(g.faces, dtype=int).reshape(-1, 3)
    m = trimesh.Trimesh(vertices=v, faces=fc, process=True)
    m.visual.vertex_colors = [176, 180, 186, 255]            # raw-steel grey
    nm = (sh.name or "").strip() or f"part{sh.id}"
    scene.add_geometry(m, node_name=f"{nm}#{sh.id}", geom_name=nm)
    try:
        if m.is_volume: mesh_mass += abs(m.volume) * DENS
    except Exception:
        pass
    lo = v.min(0); hi = v.max(0)
    bmin = lo if bmin is None else np.minimum(bmin, lo)
    bmax = hi if bmax is None else np.maximum(bmax, hi)
    nodes += 1
    if not it.next():
        break
scene.export(OUT_GLB)
size = (bmax - bmin)

# ----------------------------------------------------------------------------
# verification + fabrication summary
# ----------------------------------------------------------------------------
n_parts   = sum(r["qty"] for r in summary)
n_groups  = len(summary)
n_bolt    = sum(r["qty"] * r["holes_each"] for r in summary if r["grip_each"] == 0) \
          + sum(r["qty"] * (r["holes_each"] - r["grip_each"]) for r in summary if r["grip_each"] > 0)
n_grip    = sum(r["qty"] * r["grip_each"] for r in summary)
mass_anal = sum(r["mass_total"] for r in summary)
prof_types = sorted({p.is_a() for p in f.by_type("IfcProfileDef")
                     if p.is_a() != "IfcCircleProfileDef"})       # exclude hole circles
n_bool    = len(f.by_type("IfcBooleanResult"))
ENV = (1000.0, 300.0, 700.0)

def hr(c="-", n=92): return c * n

print("\n" + hr("="))
print("PCS AR DEMO  -  STEEL BEAM-TO-COLUMN MOMENT-CONNECTION SPECIMEN")
print(hr("="))
print(f"Files written : {OUT_IFC} (IFC4)   |   {OUT_GLB} ({nodes} named nodes)")
print(f"Material      : S355 structural steel (EN 10025-2),  rho = 7850 kg/m^3")
print(f"Distinct parts: {n_parts} pieces in {n_groups} part types")
print(f"Holes         : {n_bolt} bolt holes (M16 = Ø18, M20 = Ø22) + {n_grip} Ø80 grip holes")
print(f"Profile types : {', '.join(prof_types)}")
print(f"CSG booleans  : {n_bool} IfcBooleanResult difference ops (one per hole)")
print()
print(f"Bounding box  : {size[0]:.0f} W x {size[1]:.0f} D x {size[2]:.0f} H mm"
      f"   (budget {ENV[0]:.0f} x {ENV[1]:.0f} x {ENV[2]:.0f})")
env_ok = size[0] <= ENV[0] and size[1] <= ENV[1] and size[2] <= ENV[2]
print(f"Envelope      : {'PASS - fits a car trunk' if env_ok else 'FAIL - over budget'}")
print(f"Mass (calc)   : {mass_anal:.1f} kg  (cross-section x length - holes, fillets ignored)")
print(f"Mass (mesh)   : {mesh_mass:.1f} kg  (watertight solid volume incl. fillets)")
wt_ok = 60.0 <= mesh_mass <= 80.0 or 60.0 <= mass_anal <= 80.0
print(f"Weight target : {'PASS - 60-80 kg, two-person carry' if wt_ok else 'CHECK - outside 60-80 kg'}")

print("\n" + hr())
print("FABRICATION PART LIST")
print(hr())
hdr = f"{'#':>2}  {'Part':<26}{'Profile type':<28}{'Section':<13}{'Size (mm)':<26}{'Qty':>3}  {'Holes':<18}{'kg/ea':>7}{'kg tot':>8}"
print(hdr); print(hr())
mark = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
for i, r in enumerate(summary):
    holes = r["hole_label"]
    print(f"{mark[i]:>2}  {r['group']:<26}{r['ptype']:<28}{r['section']:<13}{r['dims']:<26}"
          f"{r['qty']:>3}  {holes:<18}{r['mass_each']:>7.2f}{r['mass_total']:>8.2f}")
print(hr())
print(f"{'':>2}  {'TOTAL':<26}{'':<28}{'':<13}{'':<26}{n_parts:>3}  "
      f"{str(n_bolt)+' bolt + '+str(n_grip)+' grip':<18}{'':>7}{mass_anal:>8.2f}")

SEQUENCE = [
 "Cut & drill all components (NC).  Burn/drill bolt holes: Ø22 for M20, Ø18 for M16.",
 "  Burn the Ø80 grip holes in the two handle plates.  Cut sections to length:",
 "  column W200x46 L440, beams W150x24 L300, angle L75x75x8 L200, CHS 88.9x5 L150,",
 "  channel C75x40 L180.  Deburr all holes and edges.",
 "Set the base plate (PL12 720x230) level on the bench; mark the column footprint.",
 "Stand the W200x46 column stub on the base plate, square it both ways, and weld",
 "  all-around with a full fillet (column-to-base is the critical root joint).",
 "Fit the 4 continuity/web stiffeners inside the column at the beam top & bottom",
 "  flange levels; weld to web and flanges.  Weld the doubler plate to the web",
 "  panel zone (it lines up between the stiffeners).",
 "Weld the end plates (PL16) square to each beam end, full perimeter.",
 "Offer the beams up to the column flange faces and bolt through the end plates",
 "  with 4x M20 per side (snug-tight).  This bolted interface is the primary",
 "  AR-QA check - the overlay must show all 8 holes concentric.",
 "Weld the cap plate (PL10) to the top of the column.",
 "Add the demonstrator parts: weld the shear tab (fin plate) to the upper column",
 "  flange; bolt the two web splice plates across the left beam web (4x M16 each);",
 "  bolt the top & bottom flange cover plates to the right beam (4x M16 each).",
 "Build the brace node: weld the gusset plate to the column/beam, then weld the",
 "  L75x75x8 angle brace and the CHS 88.9x5 tube stub to it; weld the C75x40",
 "  channel stiffener to the column.",
 "Weld the two carry handles to the base plate, one at each end (grip holes up).",
 "Grind/wire-brush all welds.  LEAVE BARE - do not paint or galvanise.",
 "QA: confirm dims <= 1000 x 300 x 700 mm, weigh (target 60-80 kg), then verify",
 "  the full bolt-hole pattern against the iPad AR green-wireframe overlay.",
]
print("\n" + hr())
print("ASSEMBLY / WELDING SEQUENCE")
print(hr())
step = 0
for line in SEQUENCE:
    if line.startswith("  "):
        print("      " + line.strip())
    else:
        step += 1
        print(f"{step:>2}. {line}")

FINISH = (
 "FINISH:  Leave the physical specimen UNPAINTED / bare raw steel.  A mill-scale or "
 "lightly ground steel surface gives the best contrast for the AR app's green "
 "wireframe overlay; paint (especially gloss or light colours) reflects and washes "
 "out the projection and dulls edge detection.  If flash-rust is a concern for "
 "transport, wipe with a thin clear/matte lacquer or light oil - never a pigmented "
 "coating."
)
print("\n" + hr())
print(FINISH)
print(hr("=") + "\n")

# ----- markdown copy of the summary -----
with open("FABRICATION_SUMMARY.md", "w") as md:
    md.write("# PCS AR Demo - Steel Moment-Connection Specimen\n\n")
    md.write("Portable raw-steel demonstration piece for the AR QA-overlay app. A "
             "W200 column stub with W150 beams bolted through end plates, loaded up "
             "with as many distinct fabricated part types as practical so the iPad "
             "overlay can show holes, plates and stiffeners lining up between the "
             "digital model and the steel.\n\n")
    md.write(f"- **Files:** `{OUT_IFC}` (IFC4, mm, S355) and `{OUT_GLB}` "
             f"({nodes} named part nodes, mm)\n")
    md.write(f"- **Bounding box:** {size[0]:.0f} W x {size[1]:.0f} D x {size[2]:.0f} H mm "
             f"(budget 1000 x 300 x 700) - {'fits a car trunk' if env_ok else 'OVER BUDGET'}\n")
    md.write(f"- **Mass:** {mass_anal:.1f} kg calc / {mesh_mass:.1f} kg meshed "
             f"(target 60-80 kg, two-person carry)\n")
    md.write(f"- **Parts:** {n_parts} pieces in {n_groups} types; "
             f"{n_bolt} bolt holes (M16=Ø18, M20=Ø22) + {n_grip} Ø80 grip holes\n")
    md.write(f"- **Profile types:** {', '.join(prof_types)}\n\n")
    md.write("## Part list\n\n")
    md.write("| # | Part | Profile type | Section | Size (mm) | Qty | Holes | kg/ea | kg total |\n")
    md.write("|---|------|--------------|---------|-----------|-----|-------|------:|---------:|\n")
    for i, r in enumerate(summary):
        md.write(f"| {mark[i]} | {r['group']} | `{r['ptype']}` | {r['section']} | {r['dims']} "
                 f"| {r['qty']} | {r['hole_label']} | {r['mass_each']:.2f} | {r['mass_total']:.2f} |\n")
    md.write(f"| | **TOTAL** | | | | **{n_parts}** | **{n_bolt} bolt + {n_grip} grip** "
             f"| | **{mass_anal:.1f}** |\n\n")
    md.write("## Assembly / welding sequence\n\n")
    step = 0
    for line in SEQUENCE:
        if line.startswith("  "):
            md.write(f"    {line.strip()}\n")
        else:
            step += 1
            md.write(f"{step}. {line}\n")
    md.write("\n## Finish\n\n" + FINISH + "\n")
print("Wrote FABRICATION_SUMMARY.md")
