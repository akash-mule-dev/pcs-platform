import {
  pieceColor, STATUS_LEGEND, hex, C_NCR, C_SHIPPED, C_LOADED, C_READY, C_PROD, C_NOT,
} from '../statusOverlay';
import { buildTreeIndex, displayName, defined } from '../treeIndex';
import { MAuditItem, MNode } from '../../../../services/projects.service';

const item = (p: Partial<MAuditItem>): MAuditItem => ({
  nodeId: 'n', workOrderId: 'w', workOrderNumber: 'WO-1', mark: 'M', name: null, nodeType: 'assembly',
  profile: null, materialGrade: null, lengthMm: null, weightKg: null,
  quantity: 1, status: 'not_started', percent: 0, unitsDone: 0, unitsTotal: 1, openNcrs: 0,
  totalTimeSeconds: 0, shipStatus: 'in_production', shipReadyQty: 0, ...(p as any),
} as MAuditItem);

const node = (p: Partial<MNode>): MNode => ({
  id: p.id ?? 'n', projectId: 'pr', parentId: p.parentId ?? null, nodeType: p.nodeType ?? 'part',
  name: p.name ?? 'n', quantity: 1, profile: null, materialGrade: null,
  ifcGuid: p.ifcGuid ?? null, meshName: p.meshName ?? null, modelId: p.modelId ?? null,
  mark: p.mark ?? null, lengthMm: null, weightKg: null,
});

describe('pieceColor priority (NCR > shipped > loaded > ready > prod > not)', () => {
  it('NCR wins over everything', () => {
    expect(pieceColor(item({ openNcrs: 1, shipStatus: 'shipped', status: 'completed' }))).toBe(C_NCR);
    expect(pieceColor(item({ shipStatus: 'blocked_ncr' }))).toBe(C_NCR);
  });
  it('orders ship states correctly', () => {
    expect(pieceColor(item({ shipStatus: 'shipped' }))).toBe(C_SHIPPED);
    expect(pieceColor(item({ shipStatus: 'allocated' }))).toBe(C_LOADED);
    expect(pieceColor(item({ shipStatus: 'ready' }))).toBe(C_READY);
  });
  it('falls back to production / not-started', () => {
    expect(pieceColor(item({ status: 'in_progress' }))).toBe(C_PROD);
    expect(pieceColor(item({ status: 'not_started' }))).toBe(C_NOT);
    expect(pieceColor(item({ status: 'completed' }))).toBe(C_NOT); // complete-but-not-shippable
  });
});

describe('hex + legend', () => {
  it('formats 6-digit hex', () => {
    expect(hex(C_NCR)).toBe('#c62828');
    expect(hex(0x000000)).toBe('#000000');
  });
  it('legend covers all six states', () => {
    expect(STATUS_LEGEND).toHaveLength(6);
    expect(STATUS_LEGEND.map((l) => l.label)).toContain('NCR');
  });
});

describe('buildTreeIndex', () => {
  // root → asm → (part1, part2)
  const nodes = [
    node({ id: 'root', parentId: null, nodeType: 'group', name: 'Root' }),
    node({ id: 'asm', parentId: 'root', nodeType: 'assembly', ifcGuid: 'g-asm', name: 'Asm' }),
    node({ id: 'p1', parentId: 'asm', nodeType: 'part', ifcGuid: 'g-p1' }),
    node({ id: 'p2', parentId: 'asm', nodeType: 'part', meshName: 'g-p2' }),
  ];
  const idx = buildTreeIndex(nodes);

  it('indexes parents, children and mesh names', () => {
    expect(idx.roots.map((r) => r.id)).toEqual(['root']);
    expect(idx.childrenByParent.get('asm')!.map((n) => n.id)).toEqual(['p1', 'p2']);
    expect(idx.nodeByMesh.get('g-p2')!.id).toBe('p2'); // by meshName
    expect(idx.nodeByMesh.get('g-asm')!.id).toBe('asm'); // by ifcGuid
  });
  it('collects descendant mesh guids (ifcGuid preferred, meshName fallback)', () => {
    expect(idx.descendantGuids(idx.byId.get('asm')!).sort()).toEqual(['g-asm', 'g-p1', 'g-p2']);
    expect(idx.descendantGuids(idx.byId.get('p1')!)).toEqual(['g-p1']);
  });
  it('walks ancestors nearest-first', () => {
    expect(idx.ancestorIds('p1')).toEqual(['asm', 'root']);
    expect(idx.ancestorIds('root')).toEqual([]);
  });
});

describe('name helpers', () => {
  it('defined() strips "Undefined" and blanks', () => {
    expect(defined('W310')).toBe('W310');
    expect(defined('Undefined')).toBeNull();
    expect(defined('  ')).toBeNull();
  });
  it('displayName() falls back name → mark → type', () => {
    expect(displayName(node({ name: 'Beam A' }))).toBe('Beam A');
    expect(displayName(node({ name: 'Undefined', mark: 'B12' }))).toBe('B12');
    expect(displayName(node({ name: '', mark: null, nodeType: 'part' }))).toBe('Unnamed part');
  });
});
