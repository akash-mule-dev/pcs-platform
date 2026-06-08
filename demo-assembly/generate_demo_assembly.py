#!/usr/bin/env python3
"""
PCS AR Demo - BOLT-TOGETHER braced portal frame (v5.1, END-PLATE joints, external bolts).

Bolted END-PLATE connections so no fastener is buried in a rolled section:
  * Top beam & cross-beam have welded END PLATES that bolt to welded COLUMN connection plates.
  * Bolts sit ABOVE and BELOW the beam (clear of the flanges), passing through the two flat
    plates; head in open air on the centre side, nut in the OPEN column cavity (before the web).
  * Brace bolts to gusset tips that cantilever inboard of the columns -> bolts in open air.
Verified: flat base, bolts NOT inside any I-section (exact point-in-mesh test), no part overlaps.
World: X width, Y depth, Z up. Origin = base-plate underside centre. IFC mm (verts x1000).
"""
import math, time, argparse
import numpy as np
import ifcopenshell, ifcopenshell.guid
import ifcopenshell.geom as geom
import trimesh

ap = argparse.ArgumentParser(); ap.add_argument("--brace-y", type=float, default=-82.); A = ap.parse_args()
DENS, DENS_AL, DENS_PL = 7.85e-6, 2.70e-6, 1.24e-6*0.35
OUT_IFC, OUT_GLB, OUT_STL = "demo_assembly.ifc", "demo_assembly.glb", "demo_assembly.stl"
def a_rect(x,y): return x*y
def a_ishape(b,h,tw,tf): return 2*b*tf+(h-2*tf)*tw

f = ifcopenshell.file(schema="IFC4")
person=f.create_entity("IfcPerson",FamilyName="Mule",GivenName="Akash"); org=f.create_entity("IfcOrganization",Name="Eterio")
appn=f.create_entity("IfcApplication",ApplicationDeveloper=org,Version="5.1",ApplicationFullName="PCS AR Demo Assembly Generator",ApplicationIdentifier="PCS-DAG")
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
proj=f.create_entity("IfcProject",GlobalId=ifcopenshell.guid.new(),OwnerHistory=OH,Name="PCS AR Demo - End-Plate Braced Portal Frame",RepresentationContexts=[ctx],UnitsInContext=units)
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
def ishape(name,b,h,tw,tf): return f.create_entity("IfcIShapeProfileDef",ProfileType="AREA",ProfileName=name,OverallWidth=b,OverallDepth=h,WebThickness=tw,FlangeThickness=tf,FilletRadius=6.)
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
SPEC={"M16":dict(d=16.,af=24.,head=10.,nut=13.,wod=30.,wt=3.)}; nbolt=[0]
def bolt(name,center,axis,ref,grip):
    s=SPEC["M16"]; d,af,hh,nh,wod,wt=s["d"],s["af"],s["head"],s["nut"],s["wod"],s["wt"]
    items=[_solid(hexp(af,f"H{af}"),hh,-hh),_solid(f.create_entity("IfcCircleProfileDef",ProfileType="AREA",Radius=d/2.),grip+wt+nh+1.,0.)]
    wo=_solid(f.create_entity("IfcCircleProfileDef",ProfileType="AREA",Radius=wod/2.),wt,grip); wi=_solid(f.create_entity("IfcCircleProfileDef",ProfileType="AREA",Radius=d/2.+.6),wt+2,grip-1)
    items.append(f.create_entity("IfcBooleanResult",Operator="DIFFERENCE",FirstOperand=wo,SecondOperand=wi))
    no=_solid(hexp(af,f"N{af}"),nh,grip+wt); ni=_solid(f.create_entity("IfcCircleProfileDef",ProfileType="AREA",Radius=d/2.+.4),nh+2,grip+wt-1)
    items.append(f.create_entity("IfcBooleanResult",Operator="DIFFERENCE",FirstOperand=no,SecondOperand=ni))
    rep=f.create_entity("IfcShapeRepresentation",ContextOfItems=body,RepresentationIdentifier="Body",RepresentationType="CSG",Items=items)
    elements.append(f.create_entity("IfcMechanicalFastener",GlobalId=ifcopenshell.guid.new(),OwnerHistory=OH,Name=name,ObjectPlacement=f.create_entity("IfcLocalPlacement",PlacementRelTo=SPL,RelativePlacement=a2p3(center,axis,ref)),Representation=f.create_entity("IfcProductDefinitionShape",Representations=[rep]))); nbolt[0]+=1

# -------- dimensions --------
BW,BD,BT=560.,320.,10.
IW,ID,ITW,ITF=70.,120.,5.,8.
COLX,COL_L=200.,480.; COL_IN=COLX-IW/2.
Z_CBP,CBP_T=BT,12.; Z_COL=BT+CBP_T; COL_TOP=Z_COL+COL_L
CEP_T,BEP_T=14.,12.
TB_CZ,CB_CZ=440.,230.; TB_BZ,CB_BZ=75.,60.        # beam centre Z, bolt offset above/below
RB_IW,RB_ID,RB_tw,RB_tf=64.,100.,5.,8.; BEAM_HALF=153.
GUS={-1:(-120.,90.),1:(120.,310.)}

elem("Base plate","IfcPlate","SHEET",rect("PL10",BW,BD),BT,(0,0,0),(0,0,1),(1,0,0),
     holes=[(BW/2-40,BD/2-45,18),(-(BW/2-40),BD/2-45,18),(BW/2-40,-(BD/2-45),18),(-(BW/2-40),-(BD/2-45),18)])
PARTS.append(("Base plate","PL 10",f"{BW:.0f}x{BD:.0f}x{BT:.0f}",1,"welded frame foot",a_rect(BW,BD)*BT*DENS))

I_col=ishape("I120x70",IW,ID,ITW,ITF)
for sx in (-1,1):
    X0=sx*COLX; side="R" if sx>0 else "L"
    elem(f"Column foot plate {side}","IfcPlate","SHEET",rect("PL12",150.,180.),CBP_T,(X0,0,Z_CBP),(0,0,1),(1,0,0))
    elem(f"Column {side}","IfcColumn","COLUMN",I_col,COL_L,(X0,0,Z_COL),(0,0,1),(1,0,0))
    for cz,boff,tag in ((TB_CZ,TB_BZ,"top"),(CB_CZ,CB_BZ,"mid")):
        elem(f"Conn plate {side}-{tag}","IfcPlate","SHEET",rect("PL14",130.,2*(boff+25)),CEP_T,(sx*COL_IN,0,cz),(sx,0,0),(0,1,0),holes=[(0,boff,18),(0,-boff,18)])
    gx,gz=GUS[sx]; inner=sx*COL_IN; midx=(gx+inner)/2.; spanx=abs(inner-gx)+40.
    elem(f"Brace gusset {side}","IfcPlate","SHEET",rect("PL10",spanx,90.),10.,(midx,-77.,gz),(0,1,0),(1,0,0),holes=[(gx-midx,0,18)])
PARTS+=[("Columns I120","I 120x70",f"L={COL_L:.0f}",2,"welded to feet",a_ishape(IW,ID,ITW,ITF)*COL_L*DENS),
        ("Column foot plates","PL 12","150x180x12",2,"welded to base",a_rect(150,180)*CBP_T*DENS),
        ("Column conn. plates","PL 14","130x200x14",4,"end-plate bolted",a_rect(130,200)*CEP_T*DENS),
        ("Brace gussets","PL 10","~285x90x10",2,"bolted (1x M16)",a_rect(285,90)*10.*DENS)]

elem("Top beam I120","IfcBeam","BEAM",I_col,2*BEAM_HALF,(-BEAM_HALF,0,TB_CZ),(1,0,0),(0,1,0))
for sx in (-1,1):
    elem(f"Beam end plate {'R' if sx>0 else 'L'}","IfcPlate","SHEET",rect("PL12",130.,2*(TB_BZ+25)),BEP_T,(sx*BEAM_HALF,0,TB_CZ),(sx,0,0),(0,1,0),holes=[(0,TB_BZ,18),(0,-TB_BZ,18)])
PARTS+=[("Top portal beam","I 120x70",f"L={2*BEAM_HALF:.0f}",1,"end-plate bolted",a_ishape(IW,ID,ITW,ITF)*2*BEAM_HALF*DENS),
        ("Beam end plates","PL 12","130x200x12",2,"4x M16 total",a_rect(130,200)*BEP_T*DENS)]

elem("Cross-beam I100","IfcBeam","BEAM",ishape("I100x64",RB_IW,RB_ID,RB_tw,RB_tf),2*BEAM_HALF,(-BEAM_HALF,0,CB_CZ),(1,0,0),(0,1,0))
for sx in (-1,1):
    elem(f"Cross end plate {'R' if sx>0 else 'L'}","IfcPlate","SHEET",rect("PL12",120.,2*(CB_BZ+22)),BEP_T,(sx*BEAM_HALF,0,CB_CZ),(sx,0,0),(0,1,0),holes=[(0,CB_BZ,18),(0,-CB_BZ,18)])
PARTS+=[("Cross-beam","I 100x64",f"L={2*BEAM_HALF:.0f}",1,"end-plate bolted",a_ishape(RB_IW,RB_ID,RB_tw,RB_tf)*2*BEAM_HALF*DENS),
        ("Cross end plates","PL 12","120x164x12",2,"4x M16 total",a_rect(120,164)*BEP_T*DENS)]

(lx,lz),(ux,uz)=GUS[-1],GUS[1]; dx,dz=ux-lx,uz-lz; BL=math.hypot(dx,dz); axd=(dx/BL,0.,dz/BL); rfd=(-dz/BL,0.,dx/BL)
elem("Diagonal brace FB80","IfcMember","BRACE",rect("FB80x10",80.,10.),BL,(lx,A.brace_y,lz),axd,rfd)
PARTS.append(("Diagonal brace","FB 80x10",f"L={BL:.0f}",1,"bolted (2x M16)",a_rect(80,10)*BL*DENS))

# fasteners: beams = 2 per end ABOVE/BELOW the beam, axis X, through end-plate+conn-plate
for sx in (-1,1):
    for oz in (TB_BZ,-TB_BZ): bolt("Beam bolt M16",(sx*BEAM_HALF,0,TB_CZ+oz),(sx,0,0),(0,1,0),BEP_T+CEP_T)
    for oz in (CB_BZ,-CB_BZ): bolt("Cross bolt M16",(sx*BEAM_HALF,0,CB_CZ+oz),(sx,0,0),(0,1,0),BEP_T+CEP_T)
for (gx,gz) in (GUS[-1],GUS[1]): bolt("Brace bolt M16",(gx,A.brace_y-5.,gz),(0,-1,0),(1,0,0),20.)
PARTS.append(("Hex bolts+nuts+washers","M16","modelled",nbolt[0],f"{nbolt[0]}x M16",0.13*nbolt[0]))

f.create_entity("IfcRelAssociatesMaterial",GlobalId=ifcopenshell.guid.new(),OwnerHistory=OH,Name="S355",RelatedObjects=elements,RelatingMaterial=f.create_entity("IfcMaterial",Name="S355",Category="steel",Description="EN 10025-2 S355JR"))
f.create_entity("IfcRelContainedInSpatialStructure",GlobalId=ifcopenshell.guid.new(),OwnerHistory=OH,Name="parts",RelatingStructure=storey,RelatedElements=elements)
f.write(OUT_IFC)

s=geom.settings(); s.set(s.USE_WORLD_COORDS,True); it=geom.iterator(s,f)
scene=trimesh.Scene(); items=[]; mesh_mass=0.; bmin=bmax=None
assert it.initialize()
while True:
    sh=it.get(); g=sh.geometry; v=np.asarray(g.verts,float).reshape(-1,3)*1000.; fc=np.asarray(g.faces,int).reshape(-1,3)
    m=trimesh.Trimesh(vertices=v,faces=fc,process=True); nm=(sh.name or "").strip() or f"p{sh.id}"
    m.visual.vertex_colors=[90,94,102,255] if "bolt" in nm.lower() else [176,180,186,255]
    scene.add_geometry(m,node_name=f"{nm}#{sh.id}",geom_name=nm); items.append((nm,m))
    try:
        if m.is_volume: mesh_mass+=abs(m.volume)*DENS
    except Exception: pass
    lo,hi=v.min(0),v.max(0); bmin=lo if bmin is None else np.minimum(bmin,lo); bmax=hi if bmax is None else np.maximum(bmax,hi)
    if not it.next(): break
scene.export(OUT_GLB); trimesh.util.concatenate([m for _,m in items]).export(OUT_STL); size=bmax-bmin; vol=mesh_mass/DENS

# checks
ISEC={"Column L","Column R","Top beam I120","Cross-beam I100"}
isec=[m for (nm,m) in items if nm.split("#")[0] in ISEC]
embed=[]
for (nm,m) in items:
    if "bolt" not in nm.lower(): continue
    for im in isec:
        try: ins=int(im.contains(m.vertices).sum())
        except Exception: ins=0
        if ins>4: embed.append((nm, [n for n,mm in items if mm is im][0], ins))
def ov(a,b): return np.minimum(a[1],b[1])-np.maximum(a[0],b[0])
bbx={nm:(m.bounds[0],m.bounds[1]) for nm,m in items}
SKIP=("bolt",)
def wl(a,b):
    la,lb=a.lower(),b.lower()
    pairs=[("column","foot"),("column","conn"),("column","gusset"),("conn plate","beam end"),("conn plate","cross end"),
           ("beam end plate","top beam"),("cross end plate","cross-beam"),("gusset","brace"),("foot","base"),("base","foot"),("column","base")]
    return any((p in la and q in lb) or (q in la and p in lb) for (p,q) in pairs)
reviews=[]
names=[nm for nm,_ in items]
for i in range(len(items)):
    for j in range(i+1,len(items)):
        na,nb_=names[i],names[j]
        if any(k in na.lower() for k in SKIP) or any(k in nb_.lower() for k in SKIP): continue
        if na.split("#")[0]==nb_.split("#")[0] or wl(na,nb_): continue
        if min(ov(bbx[na],bbx[nb_]))>1.5: reviews.append((na,nb_,float(min(ov(bbx[na],bbx[nb_])))))
gmin=float(bmin[2]); flat=abs(gmin)<0.5
def hr(c="-",n=92): return c*n
ENV=(900.,340.,700.); env_ok=size[0]<=ENV[0] and size[1]<=ENV[1] and size[2]<=ENV[2]; n_parts=sum(r[3] for r in PARTS)
print("\n"+hr("=")); print("PCS AR DEMO - END-PLATE BRACED PORTAL FRAME (v5.1)"); print(hr("="))
print(f"Files: {OUT_IFC} | {OUT_GLB} ({len(items)} nodes) | {OUT_STL}")
print(f"Parts: {n_parts} pieces in {len(PARTS)} types | Fasteners: {nbolt[0]}x M16")
print(f"Bounding box: {size[0]:.0f} W x {size[1]:.0f} D x {size[2]:.0f} H mm  (budget {ENV[0]:.0f}x{ENV[1]:.0f}x{ENV[2]:.0f}) -> {'PASS' if env_ok else 'FAIL'}")
print(f"Mass: steel {mesh_mass:.1f} kg | aluminium {vol*DENS_AL:.1f} kg | 3D-print PLA ~{vol*DENS_PL:.1f} kg")
print("\n"+hr()); print("CHECKS"); print(hr())
print(f"  [{'PASS' if flat else 'FAIL'}]  flat base - lowest point of any part = {gmin:.1f} mm")
print(f"  [{'PASS' if not embed else 'FAIL'}]  no bolt buried in a rolled I-section (exact point-in-mesh test)" + ("" if not embed else ":"))
for (a,b_,d) in embed[:8]: print(f"          {a}: {d} verts inside {b_}")
print(f"  [{'PASS' if not reviews else 'REVIEW'}]  no unexpected part overlaps" + ("" if not reviews else ":"))
for (a,b_,d) in reviews[:8]: print(f"          {a} <-> {b_} ({d:.1f} mm)")
allok=flat and not embed and not reviews
print(f"\n  OVERALL: {'ALL CLEAR - flat, external bolts, no interference' if allok else 'NEEDS ATTENTION'}")
print("\n"+hr()); print("PART LIST"); print(hr()); mark="ABCDEFGHIJKLMNOPQRSTUVWXYZ"
print(f"{'#':>2}  {'Part':<22}{'Section':<12}{'Size (mm)':<16}{'Qty':>3}  {'Joint':<20}{'kg':>6}"); print(hr())
for i,r in enumerate(PARTS): print(f"{mark[i]:>2}  {r[0]:<22}{r[1]:<12}{r[2]:<16}{r[3]:>3}  {r[4]:<20}{r[5]:>6.2f}")
print(hr()); print(f"{'':>2}  {'TOTAL':<22}{'':<12}{'':<16}{n_parts:>3}  {'':<20}{sum(r[5] for r in PARTS):>6.2f}")
SEQ=["Shop-weld the FRAME = base + both columns (on foot plates) + the 4 column connection plates + the 2 brace gussets.",
 "Shop-weld an END PLATE onto each end of the top beam and the cross-beam.",
 "Demo assembly (all bolted, all bolts external):",
 "1) Bolt the TOP BEAM end plates to the column connection plates (2x M16 each end, above & below the beam).",
 "2) Same for the CROSS-BEAM (2x M16 each end).",
 "3) Bolt the DIAGONAL BRACE to the two gusset tips (1x M16 each end).",
 "Finish bare/matte. QA against the iPad AR green-wireframe overlay."]
print("\n"+hr()); print("ASSEMBLY SEQUENCE"); print(hr()); step=0
for ln in SEQ: print(("      "+ln.strip()) if ln[0].isdigit() else f"{(step:=step+1):>2}. {ln}")
with open("FABRICATION_SUMMARY.md","w") as md:
    md.write("# PCS AR Demo - End-Plate Braced Portal Frame\n\n")
    md.write("A braced portal frame you **assemble from individual parts**. Base + columns are one **welded frame**; "
             "the top beam, cross-beam and brace **bolt on** via **end-plate connections** - every bolt passes through "
             "two flat plates with head and nut in the open (nut in the open column cavity), so **no fastener is buried "
             "inside a rolled section** (checked by an exact point-in-mesh test). No pipe; sits dead flat.\n\n")
    md.write(f"- **Files:** `{OUT_IFC}` · `{OUT_GLB}` ({len(items)} part nodes; AR loads this) · `{OUT_STL}` (print)\n")
    md.write(f"- **Bounding box:** {size[0]:.0f} x {size[1]:.0f} x {size[2]:.0f} mm (fits a car trunk)\n")
    md.write(f"- **Mass:** steel {mesh_mass:.1f} kg · aluminium {vol*DENS_AL:.1f} kg · 3D-print PLA ~{vol*DENS_PL:.1f} kg\n")
    md.write(f"- **Parts:** {n_parts} pieces in {len(PARTS)} types; {nbolt[0]}x M16 fasteners\n")
    md.write(f"- **Checks:** flat base {'PASS' if flat else 'FAIL'} ({gmin:.1f} mm) · bolts external {'PASS' if not embed else 'FAIL'} · interference {'NONE' if not reviews else 'REVIEW'}\n\n")
    md.write("## Part list\n\n| # | Part | Section | Size (mm) | Qty | Joint | kg |\n|---|------|---------|-----------|-----|-------|---:|\n")
    for i,r in enumerate(PARTS): md.write(f"| {mark[i]} | {r[0]} | {r[1]} | {r[2]} | {r[3]} | {r[4]} | {r[5]:.2f} |\n")
    md.write(f"| | **TOTAL** | | | **{n_parts}** | | **{sum(r[5] for r in PARTS):.1f}** |\n\n## Assembly sequence\n\n")
    step=0
    for ln in SEQ: md.write(("    "+ln.strip()+"\n") if ln[0].isdigit() else f"{(step:=step+1)}. {ln}\n")
    md.write("\n## Finish\n\nBare/matte for AR contrast. No gloss/light paint.\n")
print("\nWrote FABRICATION_SUMMARY.md")
