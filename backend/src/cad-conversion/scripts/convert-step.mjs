/**
 * STEP assembly extractor + GLB converter (single XDE pass).
 *
 * Plain STEP→GLB (convert-cad.mjs) collapses the whole model into one shape via
 * STEPControl_Reader.OneShape() — geometry only, no tree. This script instead
 * reads the STEP with the XDE layer (STEPCAFControl_Reader → XCAFDoc), which
 * PRESERVES the product/assembly structure (PRODUCT + NEXT_ASSEMBLY_USAGE_
 * OCCURRENCE) that SolidWorks/Inventor/etc. write, and emits BOTH:
 *
 *   1. a normalized assembly-tree JSON (same shape as extract-ifc-structure.mjs)
 *      that the backend persists into `assembly_nodes`, and
 *   2. a GLB whose every part is one node named by that part's stable key,
 *      so the 3D viewer can highlight/colour a part by `assembly_nodes.ifc_guid`
 *      (== mesh_name == GLB node name) exactly like the IFC path.
 *
 * Because both outputs come from the SAME walk, the tree node keys and the GLB
 * node names are guaranteed to line up.
 *
 * Usage: node convert-step.mjs <input.step> <output.glb> <output.json>
 */
import * as fs from 'fs';
import * as crypto from 'crypto';
import { loadOpenCascade } from './oc-loader.mjs';
import { buildGLB } from './glb-build.mjs';

const [, , inputPath, glbPath, jsonPath] = process.argv;
if (!inputPath || !glbPath || !jsonPath) {
  console.error('Usage: convert-step.mjs <input.step> <output.glb> <output.json>');
  process.exit(1);
}

async function main() {
  const oc = await loadOpenCascade();
  const ST = oc.XCAFDoc_ShapeTool;

  // OCCT converts STEP geometry to this unit on read (default already MM).
  try { oc.Interface_Static.SetCVal('xstep.cascade.unit', 'MM'); } catch { /* default is MM */ }

  // ── Read the STEP into an XDE document (keeps the assembly structure) ──────
  const doc = new oc.TDocStd_Document(new oc.TCollection_ExtendedString_1());
  const reader = new oc.STEPCAFControl_Reader_1();
  oc.FS.writeFile('/in.step', fs.readFileSync(inputPath));
  const status = reader.ReadFile('/in.step');
  const done = oc.IFSelect_ReturnStatus.IFSelect_RetDone;
  if ((status?.value ?? status) !== (done?.value ?? done)) {
    throw new Error(`Failed to read STEP file (status ${status?.value ?? status})`);
  }
  if (!reader.Transfer_1(new oc.Handle_TDocStd_Document_2(doc), new oc.Message_ProgressRange_1())) {
    throw new Error('STEP transfer produced no XDE document');
  }
  const tool = oc.XCAFDoc_DocumentTool.ShapeTool(doc.Main()).get();

  // ── Helpers ───────────────────────────────────────────────────────────────
  const asciiToJs = (ascii) => {
    let s = '';
    const n = ascii.Length();
    for (let i = 1; i <= n; i++) { const c = ascii.Value(i); s += typeof c === 'number' ? String.fromCharCode(c) : c; }
    return s;
  };
  const labelName = (label) => {
    try {
      const attr = new oc.Handle_TDF_Attribute_1();
      if (label.FindAttribute_1(oc.TDataStd_Name.GetID(), attr) && !attr.IsNull()) {
        const name = asciiToJs(new oc.TCollection_AsciiString_13(attr.get().Get(), 63)).trim();
        return name || null;
      }
    } catch { /* unnamed */ }
    return null;
  };
  const bboxDims = (shape) => {
    try {
      const b = new oc.Bnd_Box_1();
      oc.BRepBndLib.Add(shape, b, false);
      if (b.IsVoid()) return null;
      const lo = b.CornerMin(), hi = b.CornerMax();
      return [hi.X() - lo.X(), hi.Y() - lo.Y(), hi.Z() - lo.Z()];
    } catch { return null; }
  };
  // Triangulate a world-placed shape into flat positions+indices for the GLB.
  const tessellate = (shape) => {
    const verts = [];
    const indices = [];
    try {
      const dims = bboxDims(shape) || [100, 100, 100];
      const diag = Math.hypot(dims[0], dims[1], dims[2]) || 100;
      const lin = Math.min(Math.max(diag * 0.002, 0.2), 5); // ~0.2% of size, clamped (mm)
      new oc.BRepMesh_IncrementalMesh_2(shape, lin, false, 0.5, false);
      const exp = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
      while (exp.More()) {
        const face = oc.TopoDS.Face_1(exp.Current());
        const loc = new oc.TopLoc_Location_1();
        const triH = oc.BRep_Tool.Triangulation(face, loc);
        if (!triH.IsNull()) {
          const tri = triH.get();
          const trsf = loc.Transformation();
          const base = verts.length / 3;
          const nb = tri.NbNodes();
          for (let i = 1; i <= nb; i++) {
            const p = tri.Node(i).Transformed(trsf);
            verts.push(p.X(), p.Y(), p.Z());
          }
          const nt = tri.NbTriangles();
          for (let i = 1; i <= nt; i++) {
            const t = tri.Triangle(i);
            indices.push(base + t.Value(1) - 1, base + t.Value(2) - 1, base + t.Value(3) - 1);
          }
        }
        exp.Next();
      }
    } catch (e) {
      console.error(`[step] tessellation skipped for a part: ${e.message || e}`);
    }
    return { verts, indices };
  };

  // ── Walk the assembly graph, emitting tree nodes + part meshes ────────────
  const nodes = [];
  const meshes = [];
  let order = 0;
  const usedKeys = new Set();

  // Stable, path-derived key so unrelated changes elsewhere don't renumber a
  // part (STEP has no GlobalId): hash of the name-path + per-name sibling index.
  const keyFor = (pathStr) => {
    let key = 'step-' + crypto.createHash('sha1').update(pathStr).digest('hex').slice(0, 28);
    while (usedKeys.has(key)) key = 'step-' + crypto.createHash('sha1').update(pathStr + '~' + usedKeys.size).digest('hex').slice(0, 28);
    usedKeys.add(key);
    return key;
  };

  // protoLabel: prototype label (assembly or part). pathStr: stable path prefix.
  const visit = (protoLabel, displayName, parentKey, depth, accLoc, pathStr) => {
    const isAsm = ST.IsAssembly(protoLabel);
    const myKey = keyFor(pathStr);
    const name = (displayName || (isAsm ? 'Assembly' : 'Part')).slice(0, 250);
    const type = isAsm ? (depth === 0 ? 'assembly' : 'subassembly') : 'part';

    let lengthMm = null;
    if (!isAsm) {
      const world = ST.GetShape_2(protoLabel).Moved(accLoc);
      const dims = bboxDims(world);
      if (dims) lengthMm = Math.round(Math.max(dims[0], dims[1], dims[2]) * 100) / 100;
      const { verts, indices } = tessellate(world);
      if (verts.length && indices.length) meshes.push({ name: myKey, vertices: verts, indices });
    }

    nodes.push({
      externalId: myKey,
      parentExternalId: parentKey,
      type,
      ifcClass: isAsm ? 'STEP_ASSEMBLY' : 'STEP_PART',
      name,
      mark: name.slice(0, 100),
      quantity: 1,
      profile: null,
      materialGrade: null,
      lengthMm,
      weightKg: null,
      meshName: isAsm ? null : myKey,
      depth,
      sortIndex: order++,
      properties: { source: 'step' },
    });

    if (isAsm) {
      const comps = new oc.TDF_LabelSequence_1();
      ST.GetComponents(protoLabel, comps, false);
      const siblingNameCount = new Map();
      for (let j = 1; j <= comps.Length(); j++) {
        const comp = comps.Value(j);
        const childAcc = accLoc.Multiplied(ST.GetShape_2(comp).Location_1());
        const referred = new oc.TDF_Label();
        let proto = comp;
        let childName = labelName(comp);
        if (ST.GetReferredShape(comp, referred)) {
          proto = referred;
          childName = labelName(referred) || childName; // PRODUCT name lives on the prototype
        }
        childName = childName || `Part ${j}`;
        const ord = (siblingNameCount.get(childName) ?? 0) + 1;
        siblingNameCount.set(childName, ord);
        visit(proto, childName, myKey, depth + 1, childAcc, `${pathStr}/${childName}#${ord}`);
      }
    }
  };

  const free = new oc.TDF_LabelSequence_1();
  tool.GetFreeShapes(free);
  for (let i = 1; i <= free.Length(); i++) {
    const root = free.Value(i);
    const rname = labelName(root) || `Model ${i}`;
    visit(root, rname, null, 0, new oc.TopLoc_Location_1(), `${rname}#${i}`);
  }

  if (!nodes.length) throw new Error('The STEP file produced no shapes (empty or unsupported)');

  // ── Write the GLB (best-effort: a structure-only STEP still yields a tree) ──
  let glbWritten = false;
  if (meshes.length) {
    try {
      fs.writeFileSync(glbPath, buildGLB(meshes));
      glbWritten = true;
    } catch (e) {
      console.error(`[step] GLB build failed (tree still emitted): ${e.message || e}`);
    }
  }

  const counts = nodes.reduce((a, n) => ((a[n.type] = (a[n.type] || 0) + 1), a), {});
  const out = {
    format: 'step',
    rootCount: free.Length(),
    nodeCount: nodes.length,
    glb: glbWritten ? { path: glbPath, meshes: meshes.length } : null,
    counts,
    nodes,
  };
  fs.writeFileSync(jsonPath, JSON.stringify(out));
  console.log(`STEP extracted: ${nodes.length} nodes (${JSON.stringify(counts)}), ${meshes.length} meshes${glbWritten ? '' : ' (no GLB)'}`);
}

main().catch((err) => {
  console.error(`STEP conversion error: ${err.message || err}`);
  process.exit(1);
});
