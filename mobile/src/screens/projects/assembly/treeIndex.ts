// Pure indexing helpers for the assembly tree — shared by the project-wide and
// per-work-order 3D viewers. No RN/Viro imports, unit-testable.
import { MNode } from '../../../services/projects.service';

export interface TreeIndex {
  byId: Map<string, MNode>;
  childrenByParent: Map<string, MNode[]>;
  /** ifc_guid AND mesh_name → node, so a tapped GLB mesh resolves to its node. */
  nodeByMesh: Map<string, MNode>;
  roots: MNode[];
  /** Every mesh name (ifc_guid) at/under `n` — the meshes a node "owns" in 3D. */
  descendantGuids: (n: MNode) => string[];
  /** Ancestor node ids from `id` up to the root (nearest first). */
  ancestorIds: (id: string) => string[];
}

export function buildTreeIndex(nodes: MNode[]): TreeIndex {
  const byId = new Map<string, MNode>();
  nodes.forEach((n) => byId.set(n.id, n));

  const childrenByParent = new Map<string, MNode[]>();
  nodes.forEach((n) => {
    if (!n.parentId) return;
    const a = childrenByParent.get(n.parentId) ?? [];
    a.push(n);
    childrenByParent.set(n.parentId, a);
  });

  const nodeByMesh = new Map<string, MNode>();
  nodes.forEach((n) => {
    if (n.ifcGuid) nodeByMesh.set(n.ifcGuid, n);
    if (n.meshName) nodeByMesh.set(n.meshName, n);
  });

  const roots = nodes.filter((n) => !n.parentId || !byId.has(n.parentId));

  const descendantGuids = (n: MNode): string[] => {
    const out: string[] = [];
    const stack = [n];
    while (stack.length) {
      const cur = stack.pop()!;
      const g = cur.ifcGuid || cur.meshName;
      if (g) out.push(g);
      (childrenByParent.get(cur.id) ?? []).forEach((c) => stack.push(c));
    }
    return out;
  };

  const ancestorIds = (id: string): string[] => {
    const out: string[] = [];
    let p = byId.get(id)?.parentId ?? null;
    while (p) { out.push(p); p = byId.get(p)?.parentId ?? null; }
    return out;
  };

  return { byId, childrenByParent, nodeByMesh, roots, descendantGuids, ancestorIds };
}

/** IFC exporters write "Undefined" for missing values — treat it as empty. */
export function defined(v: string | null | undefined): string | null {
  const t = (v ?? '').trim();
  return t && t.toLowerCase() !== 'undefined' ? t : null;
}

export function displayName(n: MNode): string {
  const name = (n.name ?? '').trim();
  if (name && name.toLowerCase() !== 'undefined') return name;
  return n.mark || `Unnamed ${n.nodeType}`;
}
