/**
 * PCS demo IFC generator.
 *
 * Emits three small, bolt-together steel assemblies as IFC4 STEP files that
 * import cleanly into the PCS fabrication pipeline (assembly tree + fab columns
 * + viewable GLB). Every part is <= 700 mm so the loose kit fits in a car boot.
 *
 *   demo_minimal.ifc   - "Bolted Post Stand"        (3 fabricated marks)
 *   demo_balanced.ifc  - "Bolted Table Frame"       (2 welded sub-frames + rails)
 *   demo_rich.ifc      - "Bolted Braced Portal Bay" (I-beams, gussets, 2 grades)
 *
 * Mirrors the entity patterns of demo-assembly/demo_assembly.ifc (the known-good
 * fixture): IFC4, MILLI METRE units, IfcExtrudedAreaSolid geometry, an
 * IfcProject->IfcSite->IfcBuilding->IfcBuildingStorey spine, IfcElementAssembly
 * grouping, IfcRelAssociatesMaterial for grade, and a Pset_PCS_Fabrication that
 * carries PieceMark / Profile / Grade / Length / NetWeight so all five fab
 * columns populate from properties (geometry is just for the 3D model).
 *
 * GlobalIds are deterministic (md5(key) -> IFC compressed GUID) so re-running the
 * generator and re-importing upserts the same nodes instead of duplicating.
 *
 * Usage: node demo-assembly/generate-demos.mjs
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const STEEL = 7850; // kg/m^3

// ---- IFC compressed-GUID (IfcOpenShell algorithm) ----------------------------
const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
function b64(v, len) { let o = ''; for (let i = 0; i < len; i++) { o = B64[v % 64] + o; v = Math.floor(v / 64); } return o; }
function guid(key) {
  const h = createHash('md5').update(key).digest('hex');
  const bs = []; for (let i = 0; i < 16; i++) bs.push(parseInt(h.substr(i * 2, 2), 16));
  return b64(bs[0], 2)
    + b64(bs[1] * 65536 + bs[2] * 256 + bs[3], 4)
    + b64(bs[4] * 65536 + bs[5] * 256 + bs[6], 4)
    + b64(bs[7] * 65536 + bs[8] * 256 + bs[9], 4)
    + b64(bs[10] * 65536 + bs[11] * 256 + bs[12], 4)
    + b64(bs[13] * 65536 + bs[14] * 256 + bs[15], 4);
}

// ---- formatting helpers ------------------------------------------------------
function R(n) { let s = (Math.round(n * 1e6) / 1e6).toString(); if (/[eE]/.test(s)) return s; if (!s.includes('.')) s += '.'; return s; }
function esc(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "''"); }
const barKg = (kgPerM, lenMm) => kgPerM * (lenMm / 1000);
const plateKg = (wMm, hMm, tMm) => (wMm / 1000) * (hMm / 1000) * (tMm / 1000) * STEEL;

// nominal mass per metre for the profiles used
const KGM = { 'SHS40x40x3': 3.45, 'SHS50x50x3': 4.35, 'IPE100': 8.10, 'FB60x8': 0.06 * 0.008 * STEEL };

const UP = [0, 0, 1], AX = [1, 0, 0], AY = [0, 1, 0];
function norm(v) { const m = Math.hypot(...v); return [v[0] / m, v[1] / m, v[2] / m]; }

// ---- IFC builder -------------------------------------------------------------
class Ifc {
  constructor(projectName, key) {
    this.key = key; this.id = 0; this.lines = []; this.matMembers = new Map();
    this.person = this.add(`IFCPERSON($,'Mule','Akash',$,$,$,$,$)`);
    this.org = this.add(`IFCORGANIZATION($,'Eterio',$,$,$)`);
    this.app = this.add(`IFCAPPLICATION(${this.org},'1.0','PCS Demo IFC Generator','PCS-DEMO-GEN')`);
    this.pando = this.add(`IFCPERSONANDORGANIZATION(${this.person},${this.org},$)`);
    this.owner = this.add(`IFCOWNERHISTORY(${this.pando},${this.app},$,.ADDED.,$,$,$,1780925860)`);
    this.lenUnit = this.add(`IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)`);
    this.angUnit = this.add(`IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)`);
    this.units = this.add(`IFCUNITASSIGNMENT((${this.lenUnit},${this.angUnit}))`);
    const wcsP = this.pt(0, 0, 0); const wcs = this.add(`IFCAXIS2PLACEMENT3D(${wcsP},$,$)`);
    this.ctx = this.add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.0E-05,${wcs},$)`);
    this.body = this.add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${this.ctx},$,.MODEL_VIEW.,$)`);
    this.project = this.add(`IFCPROJECT('${guid(key + '/project')}',${this.owner},'${esc(projectName)}',$,$,$,$,(${this.ctx}),${this.units})`);
    const sitePlc = this.localPlacement(null);
    this.site = this.add(`IFCSITE('${guid(key + '/site')}',${this.owner},'Site',$,$,${sitePlc},$,$,.ELEMENT.,$,$,$,$,$)`);
    const bPlc = this.localPlacement(sitePlc);
    this.building = this.add(`IFCBUILDING('${guid(key + '/building')}',${this.owner},'Workshop',$,$,${bPlc},$,$,.ELEMENT.,$,$,$)`);
    this.storeyPlc = this.localPlacement(bPlc);
    this.storey = this.add(`IFCBUILDINGSTOREY('${guid(key + '/storey')}',${this.owner},'Shop Floor',$,$,${this.storeyPlc},$,$,.ELEMENT.,$)`);
    this.aggregate(this.project, [this.site], 'spine0');
    this.aggregate(this.site, [this.building], 'spine1');
    this.aggregate(this.building, [this.storey], 'spine2');
    this.zdir = this.dir(0, 0, 1);
  }
  add(body) { this.id++; this.lines.push(`#${this.id}=${body};`); return `#${this.id}`; }
  pt(x, y, z) { return this.add(`IFCCARTESIANPOINT((${R(x)},${R(y)},${R(z)}))`); }
  dir(x, y, z) { return this.add(`IFCDIRECTION((${R(x)},${R(y)},${R(z)}))`); }
  localPlacement(rel, axis2) { const a2 = axis2 || this.add(`IFCAXIS2PLACEMENT3D(${this.pt(0, 0, 0)},$,$)`); return this.add(`IFCLOCALPLACEMENT(${rel || '$'},${a2})`); }
  placeAt(start, dirVec, refVec) {
    const loc = this.pt(start[0], start[1], start[2]);
    const axis = dirVec ? this.dir(dirVec[0], dirVec[1], dirVec[2]) : null;
    const ref = refVec ? this.dir(refVec[0], refVec[1], refVec[2]) : null;
    const a2 = this.add(`IFCAXIS2PLACEMENT3D(${loc},${axis || '$'},${ref || '$'})`);
    return this.localPlacement(this.storeyPlc, a2);
  }
  profile(p) {
    if (p.kind === 'rect') return this.add(`IFCRECTANGLEPROFILEDEF(.AREA.,'${esc(p.name)}',$,${R(p.x)},${R(p.y)})`);
    if (p.kind === 'i') return this.add(`IFCISHAPEPROFILEDEF(.AREA.,'${esc(p.name)}',$,${R(p.b)},${R(p.h)},${R(p.tw)},${R(p.tf)},${R(p.r)},$,$)`);
    if (p.kind === 'circle') return this.add(`IFCCIRCLEPROFILEDEF(.AREA.,'${esc(p.name)}',$,${R(p.r)})`);
    throw new Error('bad profile ' + p.kind);
  }
  aggregate(parent, children, key) { this.add(`IFCRELAGGREGATES('${guid(this.key + '/agg/' + key)}',${this.owner},$,$,${parent},(${children.join(',')}))`); }
  containStorey(refs) { this.add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid(this.key + '/contain')}',${this.owner},$,$,(${refs.join(',')}),${this.storey})`); }
  assembly(key, mark, predef) {
    const plc = this.placeAt([0, 0, 0], null, null);
    return this.add(`IFCELEMENTASSEMBLY('${guid(this.key + '/' + key)}',${this.owner},'${esc(mark)}',$,'${esc(mark)}',${plc},$,$,.FACTORY.,${predef || '.NOTDEFINED.'})`);
  }
  pset(el, key, f) {
    const props = [];
    if (f.mark != null) props.push(this.add(`IFCPROPERTYSINGLEVALUE('PieceMark',$,IFCIDENTIFIER('${esc(f.mark)}'),$)`));
    if (f.profile != null) props.push(this.add(`IFCPROPERTYSINGLEVALUE('Profile',$,IFCTEXT('${esc(f.profile)}'),$)`));
    if (f.grade != null) props.push(this.add(`IFCPROPERTYSINGLEVALUE('Grade',$,IFCTEXT('${esc(f.grade)}'),$)`));
    if (f.length != null) props.push(this.add(`IFCPROPERTYSINGLEVALUE('Length',$,IFCREAL(${R(f.length)}),$)`));
    if (f.weight != null) props.push(this.add(`IFCPROPERTYSINGLEVALUE('NetWeight',$,IFCREAL(${R(f.weight)}),$)`));
    const ps = this.add(`IFCPROPERTYSET('${guid(this.key + '/pset/' + key)}',${this.owner},'Pset_PCS_Fabrication',$,(${props.join(',')}))`);
    this.add(`IFCRELDEFINESBYPROPERTIES('${guid(this.key + '/reldef/' + key)}',${this.owner},$,$,(${el}),${ps})`);
  }
  setGrade(el, grade) { if (!this.matMembers.has(grade)) this.matMembers.set(grade, []); this.matMembers.get(grade).push(el); }
  finishMaterials() {
    let i = 0;
    for (const [grade, refs] of this.matMembers) {
      const m = this.add(`IFCMATERIAL('${esc(grade)}',$,'steel')`);
      this.add(`IFCRELASSOCIATESMATERIAL('${guid(this.key + '/mat/' + grade)}',${this.owner},'${esc(grade)}',$,(${refs.join(',')}),${m})`);
      i++;
    }
  }
  // Build a fabricated part: geometry + element + Pset + grade. Returns the element ref.
  part(spec) {
    const prof = this.profile(spec.profile);
    const solidPlc = this.add(`IFCAXIS2PLACEMENT3D(${this.pt(0, 0, 0)},$,$)`);
    const solid = this.add(`IFCEXTRUDEDAREASOLID(${prof},${solidPlc},${this.zdir},${R(spec.extrude)})`);
    const rep = this.add(`IFCSHAPEREPRESENTATION(${this.body},'Body','SweptSolid',(${solid}))`);
    const prod = this.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${rep}))`);
    const plc = this.placeAt(spec.start, spec.dir, spec.refDir);
    const el = this.add(`${spec.ifcType}('${guid(this.key + '/' + spec.key)}',${this.owner},'${esc(spec.name)}',$,'${esc(spec.mark)}',${plc},${prod},$,${spec.predef})`);
    this.pset(el, spec.key, { mark: spec.mark, profile: spec.profileName, grade: spec.grade, length: spec.lengthMm, weight: spec.weight });
    this.setGrade(el, spec.grade);
    return el;
  }
  toString() {
    const header = [
      'ISO-10303-21;', 'HEADER;',
      `FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');`,
      `FILE_NAME('','2026-06-14T00:00:00',(''),(''),'PCS Demo IFC Generator','PCS-DEMO-GEN','');`,
      `FILE_SCHEMA(('IFC4'));`, 'ENDSEC;', 'DATA;',
    ].join('\n');
    return header + '\n' + this.lines.join('\n') + '\nENDSEC;\nEND-ISO-10303-21;\n';
  }
}

// reusable profile descriptors
const P = {
  shs40: { kind: 'rect', name: 'SHS40x40x3', x: 40, y: 40 },
  shs50: { kind: 'rect', name: 'SHS50x50x3', x: 50, y: 50 },
  ipe100: { kind: 'i', name: 'IPE100', b: 55, h: 100, tw: 4.1, tf: 5.7, r: 7 },
  fb60: { kind: 'rect', name: 'FB60x8', x: 60, y: 8 },
  m12: { kind: 'circle', name: 'M12', r: 6 },
  m16: { kind: 'circle', name: 'M16', r: 8 },
};
const plate = (name, x, y) => ({ kind: 'rect', name, x, y });

// =============================================================================
// DESIGN 1  -  Bolted Post Stand  (minimal: 3 fabricated marks + bolts)
// =============================================================================
function buildMinimal() {
  const b = new Ifc('PCS Demo 1 - Bolted Post Stand', 'minimal');
  const ST = b.assembly('ST1', 'ST-01', '.NOTDEFINED.');
  const parts = [];
  parts.push(b.part({ ifcType: 'IFCPLATE', key: 'BP1', name: 'Base plate', mark: 'BP-01', predef: '.SHEET.', grade: 'S355',
    profile: plate('PL10', 250, 250), profileName: 'PL10 250x250', extrude: 10, lengthMm: 250, weight: plateKg(250, 250, 10),
    start: [0, 0, 0], dir: UP, refDir: AX }));
  parts.push(b.part({ ifcType: 'IFCCOLUMN', key: 'P1', name: 'Post (tube + welded foot & cap plate)', mark: 'P-01', predef: '.COLUMN.', grade: 'S355',
    profile: P.shs50, profileName: 'SHS50x50x3', extrude: 600, lengthMm: 600, weight: barKg(KGM['SHS50x50x3'], 600) + 2 * plateKg(120, 120, 10),
    start: [0, 0, 10], dir: UP, refDir: AX }));
  parts.push(b.part({ ifcType: 'IFCBEAM', key: 'TA1', name: 'Top arm (tube + welded end plate)', mark: 'TA-01', predef: '.BEAM.', grade: 'S355',
    profile: P.shs50, profileName: 'SHS50x50x3', extrude: 350, lengthMm: 350, weight: barKg(KGM['SHS50x50x3'], 350) + plateKg(120, 120, 10),
    start: [0, 0, 635], dir: AX, refDir: AY }));
  // 4 base bolts (visible bolted joint)
  for (let i = 0; i < 4; i++) {
    const x = i % 2 ? 90 : -90, y = i < 2 ? 90 : -90;
    parts.push(b.part({ ifcType: 'IFCMEMBER', key: 'BLT' + i, name: 'Bolt M12 x 40', mark: 'M12', predef: '.MEMBER.', grade: '8.8',
      profile: P.m12, profileName: 'M12 bolt', extrude: 45, lengthMm: 40, weight: 0.06,
      start: [x, y, -8], dir: UP, refDir: AX }));
  }
  b.containStorey([ST]);
  b.aggregate(ST, parts, 'ST1');
  b.finishMaterials();
  return b.toString();
}

// =============================================================================
// DESIGN 2  -  Bolted Table Frame  (balanced: 2 welded sub-frames + cross rails)
// =============================================================================
function buildBalanced() {
  const b = new Ifc('PCS Demo 2 - Bolted Table Frame', 'balanced');
  const TBL = b.assembly('TBL1', 'TBL-01', '.NOTDEFINED.');
  const topChildren = [];

  function endFrame(tag, yf) {
    const ef = b.assembly('EF_' + tag, 'EF-' + tag, '.NOTDEFINED.');
    const sub = [];
    for (const [n, x] of [['L', -190], ['R', 190]]) {
      sub.push(b.part({ ifcType: 'IFCPLATE', key: `FP_${tag}_${n}`, name: 'Foot plate', mark: 'FP-01', predef: '.SHEET.', grade: 'S355',
        profile: plate('PL10', 130, 130), profileName: 'PL10 130x130', extrude: 10, lengthMm: 130, weight: plateKg(130, 130, 10),
        start: [x, yf, 0], dir: UP, refDir: AX }));
      sub.push(b.part({ ifcType: 'IFCCOLUMN', key: `LEG_${tag}_${n}`, name: 'Leg', mark: 'LEG-01', predef: '.COLUMN.', grade: 'S355',
        profile: P.shs40, profileName: 'SHS40x40x3', extrude: 500, lengthMm: 500, weight: barKg(KGM['SHS40x40x3'], 500),
        start: [x, yf, 10], dir: UP, refDir: AX }));
    }
    sub.push(b.part({ ifcType: 'IFCBEAM', key: `HR_${tag}`, name: 'Head rail', mark: 'HR-01', predef: '.BEAM.', grade: 'S355',
      profile: P.shs40, profileName: 'SHS40x40x3', extrude: 420, lengthMm: 420, weight: barKg(KGM['SHS40x40x3'], 420),
      start: [-210, yf, 530], dir: AX, refDir: AY }));
    b.aggregate(ef, sub, 'EF_' + tag);
    return ef;
  }
  topChildren.push(endFrame('A', -300));
  topChildren.push(endFrame('B', 300));

  // cross rails along Y, bolted on top of the two head rails
  for (const [n, x] of [['L', -190], ['R', 190]]) {
    topChildren.push(b.part({ ifcType: 'IFCBEAM', key: 'CR_' + n, name: 'Cross rail (tube + welded end plates)', mark: 'CR-01', predef: '.BEAM.', grade: 'S355',
      profile: P.shs40, profileName: 'SHS40x40x3', extrude: 600, lengthMm: 600, weight: barKg(KGM['SHS40x40x3'], 600) + 2 * plateKg(80, 80, 8),
      start: [x, -300, 570], dir: AY, refDir: UP }));
  }
  // 8 M12 bolts (2 per cross-rail / head-rail intersection)
  let bi = 0;
  for (const x of [-190, 190]) for (const y of [-300, 300]) for (const dy of [-40, 40]) {
    topChildren.push(b.part({ ifcType: 'IFCMEMBER', key: 'BLT' + (bi++), name: 'Bolt M12 x 60', mark: 'M12', predef: '.MEMBER.', grade: '8.8',
      profile: P.m12, profileName: 'M12 bolt', extrude: 60, lengthMm: 60, weight: 0.06,
      start: [x, y + dy, 540], dir: UP, refDir: AX }));
  }
  b.containStorey([TBL]);
  b.aggregate(TBL, topChildren, 'TBL1');
  b.finishMaterials();
  return b.toString();
}

// =============================================================================
// DESIGN 3  -  Bolted Braced Portal Bay  (rich: I-beams, gussets, two grades)
// =============================================================================
function buildRich() {
  const b = new Ifc('PCS Demo 3 - Bolted Braced Portal Bay', 'rich');
  const BAY = b.assembly('BAY1', 'BAY-01', '.RIGID_FRAME.');
  const top = [];

  function column(tag, x) {
    const col = b.assembly('COL_' + tag, 'COL-' + tag, '.NOTDEFINED.');
    const sub = [];
    sub.push(b.part({ ifcType: 'IFCPLATE', key: `BP_${tag}`, name: 'Column base plate', mark: 'BP-' + tag, predef: '.SHEET.', grade: 'S275',
      profile: plate('PL12', 180, 180), profileName: 'PL12 180x180', extrude: 12, lengthMm: 180, weight: plateKg(180, 180, 12),
      start: [x, 0, 0], dir: UP, refDir: AX }));
    sub.push(b.part({ ifcType: 'IFCCOLUMN', key: `C_${tag}`, name: 'Column IPE100', mark: 'C-' + tag, predef: '.COLUMN.', grade: 'S355',
      profile: P.ipe100, profileName: 'IPE100', extrude: 600, lengthMm: 600, weight: barKg(KGM['IPE100'], 600),
      start: [x, 0, 12], dir: UP, refDir: AX }));
    for (const [n, sy] of [['a', -45], ['b', 45]]) {
      sub.push(b.part({ ifcType: 'IFCPLATE', key: `ST_${tag}_${n}`, name: 'Base stiffener', mark: 'ST-01', predef: '.SHEET.', grade: 'S275',
        profile: plate('PL8', 80, 90), profileName: 'PL8 80x90', extrude: 8, lengthMm: 90, weight: plateKg(80, 90, 8),
        start: [x + (n === 'a' ? -4 : 4), sy, 12], dir: UP, refDir: AY }));
    }
    sub.push(b.part({ ifcType: 'IFCPLATE', key: `CAP_${tag}`, name: 'Column cap cleat', mark: 'CAP-' + tag, predef: '.SHEET.', grade: 'S275',
      profile: plate('PL10', 130, 100), profileName: 'PL10 130x100', extrude: 10, lengthMm: 130, weight: plateKg(130, 100, 10),
      start: [x, 0, 612], dir: UP, refDir: AX }));
    b.aggregate(col, sub, 'COL_' + tag);
    return col;
  }
  top.push(column('L', -300));
  top.push(column('R', 300));

  // beam sub-assembly: IPE100 + 2 end plates
  const beam = b.assembly('BEAM1', 'BM-01', '.NOTDEFINED.');
  const bsub = [];
  bsub.push(b.part({ ifcType: 'IFCBEAM', key: 'BM', name: 'Roof beam IPE100', mark: 'BM-01', predef: '.BEAM.', grade: 'S355',
    profile: P.ipe100, profileName: 'IPE100', extrude: 600, lengthMm: 600, weight: barKg(KGM['IPE100'], 600),
    start: [-300, 0, 662], dir: AX, refDir: AY }));
  for (const [n, x] of [['L', -300], ['R', 300]]) {
    bsub.push(b.part({ ifcType: 'IFCPLATE', key: 'EP_' + n, name: 'Beam end plate', mark: 'EP-01', predef: '.SHEET.', grade: 'S275',
      profile: plate('PL10', 130, 160), profileName: 'PL10 130x160', extrude: 10, lengthMm: 160, weight: plateKg(130, 160, 10),
      start: [x, 0, 662], dir: AX, refDir: AY }));
  }
  b.aggregate(beam, bsub, 'BEAM1');
  top.push(beam);

  // brace sub-assembly: diagonal flat bar + 2 gussets
  const brace = b.assembly('BRACE1', 'BR-01', '.NOTDEFINED.');
  const start = [-260, 0, 80], end = [40, 0, 560];
  const dvec = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
  const blen = Math.hypot(...dvec);
  const brsub = [];
  brsub.push(b.part({ ifcType: 'IFCMEMBER', key: 'BR', name: 'Diagonal brace FB60x8', mark: 'BR-01', predef: '.BRACE.', grade: 'S355',
    profile: P.fb60, profileName: 'FB60x8', extrude: blen, lengthMm: Math.round(blen), weight: barKg(KGM['FB60x8'], blen),
    start, dir: norm(dvec), refDir: AY }));
  for (const [n, pos] of [['L', start], ['R', end]]) {
    brsub.push(b.part({ ifcType: 'IFCPLATE', key: 'GUS_' + n, name: 'Brace gusset', mark: 'GUS-01', predef: '.SHEET.', grade: 'S275',
      profile: plate('PL8', 120, 120), profileName: 'PL8 120x120', extrude: 8, lengthMm: 120, weight: plateKg(120, 120, 8),
      start: [pos[0], pos[1], pos[2]], dir: AY, refDir: UP }));
  }
  b.aggregate(brace, brsub, 'BRACE1');
  top.push(brace);

  // M16 bolts: 4 per beam end (8) + 2 per brace end (4)
  let bi = 0;
  for (const x of [-300, 300]) for (const dz of [630, 690]) for (const dy of [-30, 30]) {
    top.push(b.part({ ifcType: 'IFCMEMBER', key: 'BLT' + (bi++), name: 'Bolt M16 x 60', mark: 'M16', predef: '.MEMBER.', grade: '8.8',
      profile: P.m16, profileName: 'M16 bolt', extrude: 55, lengthMm: 60, weight: 0.15,
      start: [x, dy, dz], dir: AX, refDir: AY }));
  }
  for (const pos of [start, end]) for (const dy of [-25, 25]) {
    top.push(b.part({ ifcType: 'IFCMEMBER', key: 'BLT' + (bi++), name: 'Bolt M16 x 60', mark: 'M16', predef: '.MEMBER.', grade: '8.8',
      profile: P.m16, profileName: 'M16 bolt', extrude: 55, lengthMm: 60, weight: 0.15,
      start: [pos[0], dy, pos[2]], dir: AY, refDir: UP }));
  }
  b.containStorey([BAY]);
  b.aggregate(BAY, top, 'BAY1');
  b.finishMaterials();
  return b.toString();
}

// ---- emit --------------------------------------------------------------------
const targets = [
  ['demo_minimal.ifc', buildMinimal],
  ['demo_balanced.ifc', buildBalanced],
  ['demo_rich.ifc', buildRich],
];
for (const [file, fn] of targets) {
  const text = fn();
  writeFileSync(join(OUT_DIR, file), text, 'utf8');
  console.log(`wrote ${file}  (${text.split('\n').length} lines)`);
}
