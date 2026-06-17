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
import { WebIO } from '@gltf-transform/core';

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
  const data = await io.writeBinary(doc);
  return { data, meshCount };
}
