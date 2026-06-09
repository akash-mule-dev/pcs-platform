/**
 * IFC structure extractor.
 *
 * Walks an IFC model's spatial structure (IfcRelAggregates) and element
 * containment (IfcRelContainedInSpatialStructure), including assembly
 * decomposition (IfcElementAssembly via IfcRelAggregates), and emits a
 * normalized JSON node tree that the backend persists into `assembly_nodes`.
 * Reads GlobalId, name, IFC class, piece mark, profile / grade / length /
 * weight. Profile and length fall back to the element's geometry (profile
 * definition name + extrusion depth, unit-normalized to mm) when not in a Pset.
 * Geometry-to-GLB remains the job of convert-ifc.mjs; this script is structure.
 *
 * Usage: node extract-ifc-structure.mjs <input.ifc> <output.json>
 */
import * as WebIFC from 'web-ifc';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error('Usage: extract-ifc-structure.mjs <input.ifc> <output.json>');
  process.exit(1);
}

const TYPE_NAME = {};
for (const k of Object.keys(WebIFC)) {
  if (/^IFC[A-Z0-9]+$/.test(k) && typeof WebIFC[k] === 'number') TYPE_NAME[WebIFC[k]] = k;
}
const SPATIAL = new Set(['IFCPROJECT', 'IFCSITE', 'IFCBUILDING', 'IFCBUILDINGSTOREY', 'IFCSPACE', 'IFCSPATIALZONE']);
const STRUCTURAL = new Set(['IFCBEAM', 'IFCCOLUMN', 'IFCMEMBER', 'IFCPLATE', 'IFCBAR', 'IFCRAILING']);

const val = (x) => (x && typeof x === 'object' && 'value' in x ? x.value : x);
const asArray = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);
const toNum = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const clsOf = (line) => TYPE_NAME[line && line.type] || `IFC_${line && line.type}`;
function pickKey(props, re) {
  for (const k of Object.keys(props)) if (re.test(k)) { const v = props[k]; if (v != null && v !== '') return v; }
  return null;
}
function pickWeight(props) {
  const keys = Object.keys(props);
  const prefer = [/material[_ ]?net[_ ]?weight/i, /piece[_ ]?net[_ ]?weight/i, /net[_ ]?weight/i, /\bweight\b/i];
  for (const re of prefer) {
    for (const k of keys) {
      if (re.test(k) && !/member|assembly|total|gross/i.test(k)) { const v = toNum(props[k]); if (v != null) return v; }
    }
  }
  for (const k of keys) if (/net[_ ]?weight|weight/i.test(k)) { const v = toNum(props[k]); if (v != null) return v; }
  return null;
}

// Length unit -> millimetres scale, read from the IfcUnitAssignment.
function lengthScaleToMm(api, model) {
  try {
    const ua = api.GetLineIDsWithType(model, WebIFC.IFCUNITASSIGNMENT);
    for (let i = 0; i < ua.size(); i++) {
      const asn = api.GetLine(model, ua.get(i));
      for (const u of asArray(asn.Units)) {
        let unit; try { unit = api.GetLine(model, val(u)); } catch { continue; }
        const utype = String(val(unit.UnitType) || '').toUpperCase();
        if (!utype.includes('LENGTH')) continue;
        const cls = clsOf(unit);
        if (cls === 'IFCSIUNIT') {
          const name = String(val(unit.Name) || '').toUpperCase();
          const prefix = String(val(unit.Prefix) || '').toUpperCase();
          if (name.includes('METRE')) {
            const pf = { MILLI: 0.001, CENTI: 0.01, DECI: 0.1, KILO: 1000 }[prefix] ?? 1;
            return pf * 1000;
          }
        } else if (cls === 'IFCCONVERSIONBASEDUNIT') {
          const n = String(val(unit.Name) || '').toLowerCase();
          if (n.includes('inch')) return 25.4;
          if (n.includes('foot') || n.includes('feet')) return 304.8;
        }
      }
    }
  } catch { /* ignore */ }
  return 1; // assume the model is already in mm
}

// Mass unit -> kilograms scale, read from the IfcUnitAssignment.
function massScaleToKg(api, model) {
  try {
    const ua = api.GetLineIDsWithType(model, WebIFC.IFCUNITASSIGNMENT);
    for (let i = 0; i < ua.size(); i++) {
      const asn = api.GetLine(model, ua.get(i));
      for (const u of asArray(asn.Units)) {
        let unit; try { unit = api.GetLine(model, val(u)); } catch { continue; }
        const utype = String(val(unit.UnitType) || '').toUpperCase();
        if (!utype.includes('MASS')) continue;
        const cls = clsOf(unit);
        if (cls === 'IFCSIUNIT') {
          const name = String(val(unit.Name) || '').toUpperCase();
          const prefix = String(val(unit.Prefix) || '').toUpperCase();
          if (name.includes('GRAM')) {
            const pf = { KILO: 1000, MILLI: 0.001, CENTI: 0.01, MEGA: 1e6 }[prefix] ?? 1;
            return pf / 1000; // gram*pf -> kg
          }
        } else if (cls === 'IFCCONVERSIONBASEDUNIT') {
          const n = String(val(unit.Name) || '').toLowerCase();
          if (n.includes('pound') || n === 'lb' || n.includes('lbf') || n.includes('lbm')) return 0.45359237;
          if (n.includes('kip')) return 453.59237;
          if (n.includes('ton')) return 907.18474;
        }
      }
    }
  } catch { /* ignore */ }
  return 1; // assume kg
}

// Resolve a member's section profile + extrusion length from its geometry.
function resolveGeom(api, model, line, scaleMm) {
  try {
    if (line.Representation == null) return {};
    const pds = api.GetLine(model, val(line.Representation));
    let profile = null;
    let depth = null;
    for (const r of asArray(pds.Representations)) {
      let shape; try { shape = api.GetLine(model, val(r)); } catch { continue; }
      for (const it of asArray(shape.Items)) {
        let item; try { item = api.GetLine(model, val(it)); } catch { continue; }
        let guard = 0;
        while (item && /BOOLEANCLIPPINGRESULT|BOOLEANRESULT/.test(clsOf(item)) && item.FirstOperand != null && guard++ < 6) {
          try { item = api.GetLine(model, val(item.FirstOperand)); } catch { item = null; }
        }
        if (item && clsOf(item) === 'IFCEXTRUDEDAREASOLID') {
          if (depth == null && item.Depth != null) depth = toNum(val(item.Depth));
          if (!profile && item.SweptArea != null) {
            try { profile = val(api.GetLine(model, val(item.SweptArea)).ProfileName) || null; } catch { /* ignore */ }
          }
        }
      }
    }
    return { profile: profile || null, lengthMm: depth != null ? depth * scaleMm : null };
  } catch { return {}; }
}

async function main() {
  const api = new WebIFC.IfcAPI();
  const require = createRequire(import.meta.url);
  const wasmDir = path.dirname(require.resolve('web-ifc/web-ifc.wasm'));
  api.SetWasmPath(wasmDir.replace(/\\/g, '/') + '/', true);
  await api.Init();

  const data = fs.readFileSync(inputPath);
  const model = api.OpenModel(data);
  const scaleMm = lengthScaleToMm(api, model);
  const massKg = massScaleToKg(api, model);

  const childrenOf = new Map();
  const addChild = (p, c) => { if (!childrenOf.has(p)) childrenOf.set(p, []); childrenOf.get(p).push(c); };
  const relAgg = api.GetLineIDsWithType(model, WebIFC.IFCRELAGGREGATES);
  for (let i = 0; i < relAgg.size(); i++) {
    const rel = api.GetLine(model, relAgg.get(i));
    for (const ro of asArray(rel.RelatedObjects)) addChild(val(rel.RelatingObject), val(ro));
  }
  const relCont = api.GetLineIDsWithType(model, WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE);
  for (let i = 0; i < relCont.size(); i++) {
    const rel = api.GetLine(model, relCont.get(i));
    for (const re of asArray(rel.RelatedElements)) addChild(val(rel.RelatingStructure), val(re));
  }

  const propsOf = new Map();
  const relProps = api.GetLineIDsWithType(model, WebIFC.IFCRELDEFINESBYPROPERTIES);
  for (let i = 0; i < relProps.size(); i++) {
    const rel = api.GetLine(model, relProps.get(i));
    let def; try { def = api.GetLine(model, val(rel.RelatingPropertyDefinition), true); } catch { continue; }
    const setName = val(def.Name) || 'Pset';
    const entries = [];
    for (const p of asArray(def.HasProperties)) {
      const pl = p && p.value ? api.GetLine(model, val(p)) : p;
      if (pl && pl.Name) entries.push([val(pl.Name), val(pl.NominalValue)]);
    }
    for (const q of asArray(def.Quantities)) {
      const ql = q && q.value ? api.GetLine(model, val(q)) : q;
      if (ql && ql.Name) {
        const qv = val(ql.LengthValue) ?? val(ql.AreaValue) ?? val(ql.VolumeValue) ?? val(ql.WeightValue) ?? val(ql.CountValue);
        entries.push([val(ql.Name), qv]);
      }
    }
    for (const ro of asArray(rel.RelatedObjects)) {
      const id = val(ro);
      if (!propsOf.has(id)) propsOf.set(id, {});
      const bag = propsOf.get(id);
      for (const [n, v] of entries) { bag[`${setName}.${n}`] = v; if (!(n in bag)) bag[n] = v; }
    }
  }

  const materialOf = new Map();
  const relMat = api.GetLineIDsWithType(model, WebIFC.IFCRELASSOCIATESMATERIAL);
  for (let i = 0; i < relMat.size(); i++) {
    const rel = api.GetLine(model, relMat.get(i));
    let name = null;
    try { name = val(api.GetLine(model, val(rel.RelatingMaterial), true).Name); } catch { /* non-simple material */ }
    if (name) for (const ro of asArray(rel.RelatedObjects)) materialOf.set(val(ro), name);
  }

  const nodes = [];
  const seen = new Set();
  let order = 0;
  const classify = (ifcClass, parentIsAssembly) => {
    if (SPATIAL.has(ifcClass)) return 'group';
    if (ifcClass === 'IFCELEMENTASSEMBLY') return parentIsAssembly ? 'subassembly' : 'assembly';
    return 'part';
  };

  function visit(expressID, parentGuid, depth, parentIsAssembly) {
    if (seen.has(expressID)) return;
    seen.add(expressID);
    let line; try { line = api.GetLine(model, expressID); } catch { return; }
    const ifcClass = clsOf(line);
    const guid = val(line.GlobalId) || `eid-${expressID}`;
    const name = val(line.Name) || ifcClass;
    const objectType = val(line.ObjectType);
    const props = propsOf.get(expressID) || {};
    const type = classify(ifcClass, parentIsAssembly);

    let mark = pickKey(props, /piece[_ ]?mark|assembly[_ ]?mark|\bmark\b|assembly[_ ]?pos|reference/i);
    if (!mark && (type === 'assembly' || type === 'subassembly')) mark = name;
    else if (!mark && type === 'part') mark = objectType || null;

    let profile = pickKey(props, /profile|section|cross[_ ]?section/i);
    let lengthMm = toNum(pickKey(props, /length/i));
    if (STRUCTURAL.has(ifcClass) && (!profile || lengthMm == null)) {
      const g = resolveGeom(api, model, line, scaleMm);
      if (!profile && g.profile) profile = g.profile;
      if (lengthMm == null && g.lengthMm != null) lengthMm = g.lengthMm;
    }
    if (!profile && objectType && /[A-Za-z]+\s?\d/.test(objectType)) profile = objectType;
    const grade = materialOf.get(expressID) || pickKey(props, /grade/i);

    nodes.push({
      externalId: String(guid),
      parentExternalId: parentGuid,
      type,
      ifcClass,
      name: String(name).slice(0, 250),
      mark: mark ? String(mark).slice(0, 100) : null,
      quantity: 1,
      profile: profile ? String(profile).slice(0, 120) : null,
      materialGrade: grade ? String(grade).slice(0, 60) : null,
      lengthMm: lengthMm != null ? Math.round(lengthMm * 100) / 100 : null,
      weightKg: (() => { const w = pickWeight(props); return w != null ? Math.round(w * massKg * 1000) / 1000 : null; })(),
      meshName: String(guid),
      depth,
      sortIndex: order++,
      properties: Object.keys(props).length ? props : null,
    });

    const isAssembly = type === 'assembly' || type === 'subassembly';
    for (const c of (childrenOf.get(expressID) || [])) visit(c, String(guid), depth + 1, isAssembly);
  }

  const projects = api.GetLineIDsWithType(model, WebIFC.IFCPROJECT);
  for (let i = 0; i < projects.size(); i++) visit(projects.get(i), null, 0, false);
  api.CloseModel(model);

  const out = {
    format: 'ifc',
    rootCount: projects.size(),
    nodeCount: nodes.length,
    lengthUnitMm: scaleMm,
    massUnitKg: massKg,
    counts: nodes.reduce((a, n) => ((a[n.type] = (a[n.type] || 0) + 1), a), {}),
    nodes,
  };
  fs.writeFileSync(outputPath, JSON.stringify(out, null, 2));
  console.log(`Extracted ${nodes.length} nodes (lengthUnitMm=${scaleMm}, massUnitKg=${massKg}): ${JSON.stringify(out.counts)}`);
}

main().catch((e) => { console.error(`IFC structure extraction error: ${e.message || e}`); process.exit(1); });
