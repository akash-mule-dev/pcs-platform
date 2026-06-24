// On-device geometry isolation: carve one node's part(s) out of the full
// project GLB so AR can render JUST that piece. Mirrors wireframeGenerator —
// pure @gltf-transform/core (no native deps), operating on in-memory GLB bytes.
//
// `meshNames` are the GLB node names to keep (== assembly_nodes.ifc_guid /
// mesh_name). For a single part that's one name; for an assembly it's every
// descendant part (the container itself has no geometry). A node is kept if its
// own name is wanted OR any descendant is, so the transform-carrying ancestor
// chain survives. Orphaned meshes/accessors/materials/textures are then GC'd via
// listParents() so the output GLB is tiny (a single part is typically a few KB).
//
// Returns the new bytes plus how many meshes survived, so the caller can fall
// back to the full model when nothing matched (e.g. a group with no geometry).
import { WebIO, getBounds } from '@gltf-transform/core';

export interface PartGlbResult {
  data: Uint8Array;
  meshCount: number;
}

export async function extractPartGlb(
  glbData: Uint8Array,
  meshNames: string[],
): Promise<PartGlbResult> {
  const io = new WebIO();
  const doc = await io.readBinary(glbData);
  const root = doc.getRoot();
  const keepSet = new Set(meshNames);

  // Mark nodes to keep. A node survives if it is the match itself, lies BELOW a
  // match (that's where the geometry usually is — the named IFC node is often
  // just a transform container, with the actual mesh on child nodes), OR lies
  // ABOVE a match (to preserve the transform-carrying ancestor chain).
  //
  // The previous logic kept only matches + their ancestors and DROPPED a match's
  // children, so whenever geometry hung off child nodes the isolated GLB came out
  // empty (0×0×0 bbox, invisible in AR). This mirrors the web 3D viewer, which
  // keeps a mesh when its own name OR any ancestor's name matches.
  const keep = new Set<any>();
  const visit = (node: any, ancestorMatched: boolean): boolean => {
    const selfMatched = keepSet.has(node.getName());
    const inKeptSubtree = ancestorMatched || selfMatched;
    let descendantMatched = false;
    for (const child of node.listChildren()) {
      if (visit(child, inKeptSubtree)) descendantMatched = true;
    }
    if (inKeptSubtree || descendantMatched) keep.add(node);
    return selfMatched || descendantMatched;
  };
  for (const scene of root.listScenes()) {
    for (const node of scene.listChildren()) visit(node, false);
  }

  // Drop every node we're not keeping (children of a dropped node are unwanted too).
  for (const node of root.listNodes()) {
    if (!keep.has(node)) node.dispose();
  }

  // GC meshes no longer referenced by any node, plus their primitives.
  for (const mesh of root.listMeshes()) {
    if (mesh.listParents().every((p: any) => p.propertyType === 'Root')) {
      for (const prim of mesh.listPrimitives()) prim.dispose();
      mesh.dispose();
    }
  }

  // GC orphaned accessors/materials/textures (two passes for material→texture chains).
  for (let pass = 0; pass < 2; pass++) {
    for (const a of root.listAccessors())
      if (a.listParents().every((p: any) => p.propertyType === 'Root')) a.dispose();
    for (const m of root.listMaterials())
      if (m.listParents().every((p: any) => p.propertyType === 'Root')) m.dispose();
    for (const t of root.listTextures())
      if (t.listParents().every((p: any) => p.propertyType === 'Root')) t.dispose();
  }

  // Count only meshes that actually carry vertices, so an isolated subtree with
  // no POSITION data reports 0 and the caller falls back to the full model.
  let meshCount = 0;
  for (const mesh of root.listMeshes()) {
    const hasVerts = mesh
      .listPrimitives()
      .some((p: any) => (p.getAttribute('POSITION')?.getCount() ?? 0) > 0);
    if (hasVerts) meshCount++;
  }

  // Recenter the isolated geometry to the origin and normalize it to a sane,
  // measurable size. A single part inherits the whole-model's fit-down scale, so
  // in WORLD space it can be only millimetres across — Viro then reports a zero
  // bounding box, AR's auto-fit can't size it, and the part renders invisibly far
  // too small. Centering + scaling the surviving geometry to ~1 m makes it
  // placeable and measurable; ARModelScene's auto-fit still refines the on-screen
  // size, and the measure tool re-derives mm/unit from the rendered geometry.
  if (meshCount > 0) {
    const scene = root.getDefaultScene() ?? root.listScenes()[0];
    if (scene) {
      const b = getBounds(scene);
      const finite =
        b && b.min.every((n: number) => isFinite(n)) && b.max.every((n: number) => isFinite(n));
      if (finite) {
        const center = [0, 1, 2].map((i) => (b.min[i] + b.max[i]) / 2);
        const longest = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
        const s = longest > 1e-9 ? 1.0 / longest : 1;
        if (s !== 1 || center.some((v) => Math.abs(v) > 1e-6)) {
          const pivot = doc
            .createNode('pcs-fit')
            .setScale([s, s, s])
            .setTranslation([-s * center[0], -s * center[1], -s * center[2]]);
          for (const child of scene.listChildren()) {
            scene.removeChild(child);
            pivot.addChild(child);
          }
          scene.addChild(pivot);
        }
      }
    }
  }

  const data = await io.writeBinary(doc);
  return { data, meshCount };
}
