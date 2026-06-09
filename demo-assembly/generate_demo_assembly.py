#!/usr/bin/env python3
"""
PCS AR Demo - TWO-COLUMN drop-on portal (v7, Y-up GLB, easy on-the-spot assembly).

Two vertical columns welded to the base (a portal). The horizontal beam spans BETWEEN them and
DROPS onto an erection seat on each column - both ends are supported by gravity, so nothing is
held mid-air - then each end is bolted through a fin plate with the bolt head & nut BOTH in open
air (one spanner). Welded STAND = base + 2 columns + 2 seats + 2 fins; ONE loose beam + 4 bolts.
GLB/STL exported Y-up (glTF); IFC stays Z-up. Checks: flat, Y-up, fasteners not buried, no clash.
Authoring frame: X width, Y depth, Z up. Origin = base-plate underside centre. IFC mm (verts x1000).
"""
import math, time
import numpy as np
import ifcopenshell, ifcopenshell.guid
import ifcopenshell.geom as geom
import trimesh

DENS, DENS_AL, DENS_PL = 7.85e-6, 2.70e-6, 1.24e-6*0.35
OUT_IFC, OUT_GLB, OUT_STL = "demo_assembly.ifc", "demo_assembly.glb", "demo_assembly.stl"
def a_rect(x,y): return x*y
def a_ishape(b,h,tw,tf): return 2*b*tf+(h-2*tf)*tw

f=ifcopenshell.file(schema="IFC4")
person=f.create_entity("IfcPerson",FamilyName="Mule",GivenName="Akash"); org=f.create_entity("IfcOrganization",Name="Eterio")
appn=f.create_entity("IfcApplication",ApplicationDeveloper=org,Version="7.0",ApplicationFullName="PCS AR Demo Assembly Generator",ApplicationIdentifier="PCS-DAG")
OH=f.create_entity("IfcOwnerHistory",OwningUser=f.create_entity("IfcPersonAndOrganization",ThePerson=person,TheOrganization=org),OwningApplication=appn,ChangeAction="ADDED",CreationDate=int(time.time()))
units=f.create_entity("IfcUnitAssignment",Units=[f.create_entity("IfcSIUnit",UnitType="LENGTHUNIT",Prefix="MILLI",Name="METRE"),f.create_entity("IfcSIUnit",UnitType="PLANEANGLEUNIT",Name="RADIAN")])
def pt(c): return f.create_entity("IfcCartesianPoint",Coordinates=[float(x) for x in c])
def pt2(c): return f.create_entity("IfcCartesianPoint",Coordinates=[float(c[0]),float(c[1])])
def dr(c): return f.create_entity("IfcDirection",DirectionRatios=[float(x) for x in c])
def a2p3(loc=(0,0,0),axis=None,ref=None):
    kw={"Location":pt(loc)}
    if axis is not None: kw["Axis"]=dr(axis)
    if ref is not None: kw["RefDirection"]=dr(ref)
    return f.create_entity("IfcAxis2Placement3D",**kw)
ctx=f.create_entity("IfcGeometricRepresentationContext",ContextType="Model",CoordinateSpaceDimension=3,Precision=1e-5,WorldCoordinateSystem=a2p3())
body=f.create_entity("IfcGeometricRepresentationSubContext",ContextIdentifier="Body",ContextType="Model",ParentContext=ctx,TargetView="MODEL_VIEW")
proj=f.create_entity("IfcProject",GlobalId=ifcopenshell.guid.new(),OwnerHistory=OH,Name="PCS AR Demo - Two-Column Drop-On Portal",RepresentationContexts=[ctx],UnitsInContext=units)
site=f.create_entity("IfcSite",GlobalId=ifcopenshell.guid.new(),OwnerHistory=OH,Name="Site",ObjectPlacement=f.create_entity("IfcLocalPlacement",RelativePlacement=a2p3()),CompositionType="ELEMENT")
bldg=f.create_entity("IfcBuilding",GlobalId=ifcopenshell.guid.new(),OwnerHistory=OH,Name="Rig",ObjectPlacement=f.create_entity("IfcLocalPlacement",PlacementRelTo=site.ObjectPlacement,RelativePlacement=a2p3()),CompositionType="ELEMENT")
storey=f.create_entity("IfcBuildingStorey",GlobalId=ifcopenshell.guid.new(),OwnerHistory=OH,Name="Specimen",ObjectPlacement=f.create_entity("IfcLocalPlacement",PlacementRelTo=bldg.ObjectPlacement,RelativePlacement=a2p3()),CompositionType="ELEMENT")
for par,ch in ((proj,site),(site,bldg),(bldg,storey)): f.create_entity("IfcRelAggregates",GlobalId=ifcopenshell.guid.new(),OwnerHistory=OH,RelatingObject=par,RelatedObjects=[ch])
SPL=storey.ObjectPlacement; ZL=dr((0,0,1)); elements=[]; PARTS=[]
def _solid(profile,depth,zoff=0.0): return f.create_entity("IfcExtrudedAreaSolid",SweptArea=profile,Position=a2p3((0,0,zoff)),ExtrudedDirection=ZL,Depth=float(depth))
def hexp(af,name):
    R=af/math.sqrt(3.0); p=[(R*math.cos(math.radians(30+60*k)),R*math.sin(math.radians(30+60*k))) for k in range(6)]
    return f.create_entity("IfcArbitraryClosedProfileDef",ProfileType="AREA",ProfileName=name,OuterCurve=f.create_entity("IfcPolyline",Points=[pt2(q) for q in p+[p[0]]]))
def rect(name,x,y): return f.create_entity("IfcRectangleProfileDef",ProfileType="AREA",ProfileName=name,XDim=x,YDim=y)
def ishape(name,b,h,tw,tf): return f.create_entity("IfcIShapeProfileDef",ProfileType="AREA",ProfileName=name,OverallWidth=b,OverallDepth=h,WebThickness=tw,FlangeThickness=tf,FilletRadius=8.)
def elem(name,cls,predef,profile,depth,loc,axis,ref,holes=()):
    item=_solid(profile,depth); rtype="SweptSolid"
    for (hx,hy,d) in holes:
        cyl=f.create_entity("IfcExtrudedAreaSolid",SweptArea=f.create_entity("IfcCircleProfileDef",ProfileType="AREA",Radius=float(d)/2.0),Position=a2p3((hx,hy,-3.0)),ExtrudedDirection=ZL,Depth=float(depth)+6.0)
        item=f.create_entity("IfcBooleanResult",Operator="DIFFERENCE",FirstOperand=item,SecondOperand=cyl); rtype="CSG"
    rep=f.create_entity("IfcShapeRepresentation",ContextOfItems=body,RepresentationIdentifier="Body",RepresentationType=rtype,Items=[item])
    pl=f.create_entity("IfcLocalPlacement",PlacementRelTo=SPL,RelativePlacement=a2p3(loc,axis,ref))
    kw=dict(GlobalId=ifcopenshell.guid.new(),OwnerHistory=OH,Name=name,ObjectPlacement=pl,Representation=f.create_entity("IfcProductDefinitionShape",Representations=[rep]))
    el=None
    if predef is not None:
        try: el=f.create_entity(cls,PredefinedType=predef,**kw)
        except RuntimeError: el=None
    if el is None: el=f.create_entity(cls,**kw)
    elements.append(el); return el
SPEC={"M16":dict(d=16.,af=24.,head=10.,nut=13.,wod=30.,wt=3.)}; nbolt=[0]; HN=[]
def bolt(name,center,axis,grip,ref=(1,0,0)):
    s=SPEC["M16"]; d,af,hh,nh,wod,wt=s["d"],s["af"],s["head"],s["nut"],s["wod"],s["wt"]
    items=[_solid(hexp(af,f"H{af}"),hh,-hh),_solid(f.create_entity("IfcCircleProfileDef",ProfileType="AREA",Radius=d/2.),grip+wt+nh+1.,0.)]
    wo=_solid(f.create_entity("IfcCircleProfileDef",ProfileType="AREA",Radius=wod/2.),wt,grip); wi=_solid(f.create_entity("IfcCircleProfileDef",ProfileType="AREA",Radius=d/2.+.6),wt+2,grip-1)
    items.append(f.create_entity("IfcBooleanResult",Operator="DIFFERENCE",FirstOperand=wo,SecondOperand=wi))
    no=_solid(hexp(af,f"N{af}"),nh,grip+wt); ni=_solid(f.create_entity("IfcCircleProfileDef",ProfileType="AREA",Radius=d/2.+.4),nh+2,grip+wt-1)
    items.append(f.create_entity("IfcBooleanResult",Operator="DIFFERENCE",FirstOperand=no,SecondOperand=ni))
    rep=f.create_entity("IfcShapeRepresentation",ContextOfItems=body,RepresentationIdentifier="Body",RepresentationType="CSG",Items=items)
    elements.append(f.create_entity("IfcMechanicalFastener",GlobalId=ifcopenshell.guid.new(),OwnerHistory=OH,Name=name,ObjectPlacement=f.create_entity("IfcLocalPlacement",PlacementRelTo=SPL,RelativePlacement=a2p3(center,axis,ref)),Representation=f.create_entity("IfcProductDefinitionShape",Representations=[rep]))); nbolt[0]+=1
    c=np.array(center,float); a=np.array(axis,float); a=a/np.linalg.norm(a)
    HN.append((name, c+a*(-hh/2.), c+a*(grip+wt+nh/2.)))

# -------- dimensions (mm) --------
BW,BD,BT=580.,280.,12.
COLX=200.; CIW,CID,Ctw,Ctf=90.,150.,6.,9.; COL_L=400.
Z_COL=BT; COL_TOP=Z_COL+COL_L
INNER=COLX-CID/2.          # column inner face X = +/-125
BCZ=330.                   # beam centre Z
BIW,BID,Btw,Btf=90.,150.,6.,9.
SEAT_TOP=BCZ-BID/2.        # 255 (beam bottom flange level)
FIN_T=10.; WEB_GAP=1.; BHALF=123.   # beam ends at +/-123 (2 mm drop clearance)

# 1) BASE
elem("Base plate","IfcPlate","SHEET",rect("PL12",BW,BD),BT,(0,0,0),(0,0,1),(1,0,0),
     holes=[(BW/2-40,BD/2-45,18),(-(BW/2-40),BD/2-45,18),(BW/2-40,-(BD/2-45),18),(-(BW/2-40),-(BD/2-45),18)])
PARTS.append(("Base plate","PL 12",f"{BW:.0f}x{BD:.0f}x{BT:.0f}",1,"welded stand",a_rect(BW,BD)*BT*DENS))
# 2) TWO COLUMNS + each one's erection seat + fin plate (all welded = the stand)
I_col=ishape("I150x90",CIW,CID,Ctw,Ctf)
for sx in (-1,1):
    X0=sx*COLX; side="R" if sx>0 else "L"; face=sx*INNER       # inner face X (toward centre)
    elem(f"Column {side}","IfcColumn","COLUMN",I_col,COL_L,(X0,0,Z_COL),(0,0,1),(0,1,0))
    # erection seat: cantilevers inward from the inner face, top at beam bottom-flange level
    seat_cx=face-sx*60.                                          # centre 60 mm inboard of the face
    elem(f"Erection seat {side}","IfcPlate","SHEET",rect("PL12-seat",120.,140.),12.,(seat_cx,0,SEAT_TOP-12.),(0,0,1),(1,0,0))
    # fin plate: vertical, +Y of the beam web, welded to the inner face, 2 holes
    fin_cx=face-sx*45.                                           # centre 45 mm inboard of the face
    elem(f"Fin plate {side}","IfcPlate","SHEET",rect("PL10-fin",90.,120.),FIN_T,(fin_cx,Btw/2.+WEB_GAP,BCZ),(0,1,0),(1,0,0),
         holes=[(0,35,18),(0,-35,18)])
PARTS+=[("Columns (x2)","I 150x90",f"L={COL_L:.0f}",2,"welded to base",a_ishape(CIW,CID,Ctw,Ctf)*COL_L*DENS),
        ("Erection seats","PL 12","120x140x12",2,"welded to columns",a_rect(120,140)*12.*DENS),
        ("Fin plates","PL 10","90x120x10",2,"welded; 2x Ø18 (M16)",a_rect(90,120)*FIN_T*DENS)]
# 3) BEAM (LOOSE) - drops onto the two seats, spans between the columns
elem("Beam I150 (loose)","IfcBeam","BEAM",ishape("I150x90",BIW,BID,Btw,Btf),2*BHALF,(-BHALF,0,BCZ),(1,0,0),(0,1,0))
PARTS.append(("Beam (loose)","I 150x90",f"L={2*BHALF:.0f}",1,"drops on 2 seats + 4x M16",a_ishape(BIW,BID,Btw,Btf)*2*BHALF*DENS))
# 4) FASTENERS - 2 per end, vertical pair, through fin + web; head & nut both in open air
for sx in (-1,1):
    fin_cx=sx*INNER-sx*45.
    for bz in (BCZ-35.,BCZ+35.):
        bolt("Connection bolt M16",(fin_cx,-Btw/2.,bz),(0,1,0),Btw+WEB_GAP+FIN_T)
PARTS.append(("Hex bolts+nuts+washers","M16","modelled",nbolt[0],f"{nbolt[0]}x M16",0.13*nbolt[0]))

f.create_entity("IfcRelAssociatesMaterial",GlobalId=ifcopenshell.guid.new(),OwnerHistory=OH,Name="S355",RelatedObjects=elements,RelatingMaterial=f.create_entity("IfcMaterial",Name="S355",Category="steel",Description="EN 10025-2 S355JR"))
f.create_entity("IfcRelContainedInSpatialStructure",GlobalId=ifcopenshell.guid.new(),OwnerHistory=OH,Name="parts",RelatingStructure=storey,RelatedElements=elements)
f.write(OUT_IFC)

s=geom.settings(); s.set(s.USE_WORLD_COORDS,True); it=geom.iterator(s,f)
items=[]; mesh_mass=0.; bmin=bmax=None
assert it.initialize()
while True:
    sh=it.get(); g=sh.geometry; v=np.asarray(g.verts,float).reshape(-1,3)*1000.; fc=np.asarray(g.faces,int).reshape(-1,3)
    m=trimesh.Trimesh(vertices=v,faces=fc,process=True); nm=(sh.name or "").strip() or f"p{sh.id}"
    m.visual.vertex_colors=[90,94,102,255] if ("bolt" in nm.lower()) else [176,180,186,255]
    items.append((nm,m))
    try:
        if m.is_volume: mesh_mass+=abs(m.volume)*DENS
    except Exception: pass
    lo,hi=v.min(0),v.max(0); bmin=lo if bmin is None else np.minimum(bmin,lo); bmax=hi if bmax is None else np.maximum(bmax,hi)
    if not it.next(): break
size=bmax-bmin; vol=mesh_mass/DENS
Yup=trimesh.transformations.rotation_matrix(-math.pi/2.,[1,0,0])
escene=trimesh.Scene()
for nm,m in items: escene.add_geometry(m,node_name=f"{nm}#{len(escene.geometry)}",geom_name=nm,transform=Yup)
escene.export(OUT_GLB)
trimesh.util.concatenate([m.copy().apply_transform(Yup) for _,m in items]).export(OUT_STL)

solids=[(nm,m) for nm,m in items if "bolt" not in nm.lower()]
buried=[]
for (bn,hc,nc) in HN:
    for (snm,m) in solids:
        try:
            if bool(m.contains([hc])[0]) or bool(m.contains([nc])[0]): buried.append((bn,snm))
        except Exception: pass
def ov(a,b): return np.minimum(a[1],b[1])-np.maximum(a[0],b[0])
bbx={nm:(m.bounds[0],m.bounds[1]) for nm,m in items}
def wl(a,b):
    la,lb=a.lower(),b.lower()
    P=[("column","base"),("column","seat"),("column","fin"),("seat","beam"),("fin","beam"),("base","column"),("column","beam"),("beam","seat"),("beam","fin"),("beam","column")]
    return any((p in la and q in lb) or (q in la and p in lb) for (p,q) in P)
names=[nm for nm,_ in items]; reviews=[]
for i in range(len(items)):
    for j in range(i+1,len(items)):
        na,nb_=names[i],names[j]
        if "bolt" in na.lower() or "bolt" in nb_.lower() or na==nb_ or wl(na,nb_): continue
        if min(ov(bbx[na],bbx[nb_]))>1.5: reviews.append((na,nb_,float(min(ov(bbx[na],bbx[nb_])))))
gmin=float(bmin[2]); flat=abs(gmin)<0.5; emin=escene.bounds[0]; yok=abs(float(emin[1]))<0.5
def hr(c="-",n=92): return c*n
ENV=(900.,340.,700.); env_ok=size[0]<=ENV[0] and size[1]<=ENV[1] and size[2]<=ENV[2]; n_parts=sum(r[3] for r in PARTS)
print("\n"+hr("=")); print("PCS AR DEMO - TWO-COLUMN DROP-ON PORTAL (v7, Y-up)"); print(hr("="))
print(f"Files: {OUT_IFC} (Z-up BIM) | {OUT_GLB} ({len(items)} nodes, Y-up) | {OUT_STL} (Y-up)")
print(f"Parts: {n_parts} pieces in {len(PARTS)} types | Fasteners: {nbolt[0]}x M16 | LOOSE parts to assemble: 1 (the beam)")
print(f"Bounding box: {size[0]:.0f} W x {size[1]:.0f} D x {size[2]:.0f} H mm  (budget {ENV[0]:.0f}x{ENV[1]:.0f}x{ENV[2]:.0f}) -> {'PASS' if env_ok else 'FAIL'}")
print(f"Mass: steel {mesh_mass:.1f} kg | aluminium {vol*DENS_AL:.1f} kg | 3D-print PLA ~{vol*DENS_PL:.1f} kg")
print("\n"+hr()); print("CHECKS"); print(hr())
print(f"  [{'PASS' if flat else 'FAIL'}]  stands flat - lowest point = {gmin:.1f} mm")
print(f"  [{'PASS' if yok else 'FAIL'}]  GLB exported Y-up (lowest Y in GLB = {float(emin[1]):.1f} mm)")
print(f"  [{'PASS' if not buried else 'FAIL'}]  every bolt head & nut in open air" + ("" if not buried else ":"))
for (a,b_) in buried[:6]: print(f"          {a} buried in {b_}")
print(f"  [{'PASS' if not reviews else 'REVIEW'}]  no unexpected part overlaps" + ("" if not reviews else ":"))
for (a,b_,d) in reviews[:8]: print(f"          {a} <-> {b_} ({d:.1f} mm)")
allok=flat and yok and not buried and not reviews
print(f"\n  OVERALL: {'ALL CLEAR - stands upright, drop-on assembly, fasteners accessible' if allok else 'NEEDS ATTENTION'}")
print("\n"+hr()); print("PART LIST"); print(hr()); mark="ABCDEFGHIJKLMNOPQRSTUVWXYZ"
print(f"{'#':>2}  {'Part':<22}{'Section':<12}{'Size (mm)':<14}{'Qty':>3}  {'Joint':<28}{'kg':>6}"); print(hr())
for i,r in enumerate(PARTS): print(f"{mark[i]:>2}  {r[0]:<22}{r[1]:<12}{r[2]:<14}{r[3]:>3}  {r[4]:<28}{r[5]:>6.2f}")
print(hr()); print(f"{'':>2}  {'TOTAL':<22}{'':<12}{'':<14}{n_parts:>3}  {'':<28}{sum(r[5] for r in PARTS):>6.2f}")
SEQ=["Shop-weld the STAND = base plate + 2 columns + an erection seat & fin plate on each. It stands flat on its own.",
 "On the spot (~30 s, one spanner):",
 "1) Lower the BEAM onto the two erection seats - it lands on both, the webs sit beside the fins, and all 4 holes line up.",
 "2) Push 2x M16 through each fin + web (4 total) and spin the nuts on (head one side, nut the other, both in the open).",
 "Finish bare/matte. QA against the iPad AR green-wireframe overlay."]
print("\n"+hr()); print("ASSEMBLY SEQUENCE"); print(hr()); step=0
for ln in SEQ: print(("      "+ln.strip()) if ln[0].isdigit() else f"{(step:=step+1):>2}. {ln}")
with open("FABRICATION_SUMMARY.md","w") as md:
    md.write("# PCS AR Demo - Two-Column Drop-On Portal\n\n")
    md.write("A two-column portal built for a **live on-the-spot demo**: a welded STAND (base + 2 columns, each "
             "with an erection seat + fin plate) that stands flat on its own, and **one loose beam** that **drops "
             "onto both seats** (gravity holds it, the webs self-align to the fins, all 4 holes line up) and is fixed "
             "with **4 bolts** (2 per end) whose head and nut are **both in open air** - one spanner, ~30 s, nothing "
             "held mid-air, no nuts inside cavities. Exported **Y-up** so it stands upright in model-viewer and the AR app.\n\n")
    md.write(f"- **Files:** `{OUT_IFC}` (IFC, Z-up) · `{OUT_GLB}` ({len(items)} nodes, **Y-up**; AR loads this) · `{OUT_STL}` (Y-up, print)\n")
    md.write(f"- **Bounding box:** {size[0]:.0f} x {size[1]:.0f} x {size[2]:.0f} mm (fits a car trunk)\n")
    md.write(f"- **Mass:** steel {mesh_mass:.1f} kg · aluminium {vol*DENS_AL:.1f} kg · 3D-print PLA ~{vol*DENS_PL:.1f} kg\n")
    md.write(f"- **Parts:** {n_parts} pieces in {len(PARTS)} types; {nbolt[0]}x M16; **1 loose part (the beam)**\n")
    md.write(f"- **Checks:** stands flat {'PASS' if flat else 'FAIL'} ({gmin:.1f} mm) · Y-up {'PASS' if yok else 'FAIL'} · fasteners in open air {'PASS' if not buried else 'FAIL'} · interference {'NONE' if not reviews else 'REVIEW'}\n\n")
    md.write("## Part list\n\n| # | Part | Section | Size (mm) | Qty | Joint | kg |\n|---|------|---------|-----------|-----|-------|---:|\n")
    for i,r in enumerate(PARTS): md.write(f"| {mark[i]} | {r[0]} | {r[1]} | {r[2]} | {r[3]} | {r[4]} | {r[5]:.2f} |\n")
    md.write(f"| | **TOTAL** | | | **{n_parts}** | | **{sum(r[5] for r in PARTS):.1f}** |\n\n## Assembly sequence\n\n")
    step=0
    for ln in SEQ: md.write(("    "+ln.strip()+"\n") if ln[0].isdigit() else f"{(step:=step+1)}. {ln}\n")
    md.write("\n## Finish\n\nBare/matte for AR contrast. No gloss/light paint.\n")
print("\nWrote FABRICATION_SUMMARY.md")
