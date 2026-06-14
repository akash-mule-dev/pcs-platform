// Server-side geometry isolation — carve one node's part(s) out of the full
// project GLB so the web portal (or any client) can fetch just that piece.
// Pure @gltf-transform/core, same algorithm as the mobile on-device extractor
// (mobile/src/screens/model-viewer/ar/partExtractor.ts) so both stay in step.
//
// `meshNames` are the GLB node names to keep (== assembly_nodes.ifc_guid /
// mesh_name). A node survives if its own name is wanted OR any descendant is
// (so the transform-carrying ancestor chain is preserved); orphaned
// meshes/accessors/materials/textures are then GC'd via listParents(). Returns
// the new bytes + surviving mesh count so callers can fall back to the full
// model when nothing matched.
//
// NOTE: @gltf-transform is loaded LAZILY (dynamic import inside the function),
// not at module top-level. `vercel-build` strips node_modules/@gltf-transform
// from the serverless bundle to stay under the size limit, and this package is
// ESM-only so webpack externalizes it rather than bundling it — a static import
// here therefore crashes the entire API on boot (Cannot find module). Same lazy
// pattern as models.controller.ts. The carving feature simply isn't available on
// the (pruned) Vercel runtime; everywhere else the import resolves normally.

export interface PartGlbResult {
  data: Uint8Array;
  meshCount: number;
}

export async function extractPartGlb(
  glbData: Uint8Array,
  meshNames: string[],
): Promise<PartGlbResult> {
  const { WebIO } = await import('@gltf-transform/core');
  const io = new WebIO();
  const doc = await io.readBinary(glbData);
  const root = doc.getRoot();
  const keepSet = new Set(meshNames);

  const keep = new Set<any>();
  const visit = (node: any): boolean => {
    let wanted = keepSet.has(node.getName());
    for (const child of node.listChildren()) {
      if (visit(child)) wanted = true;
    }
    if (wanted) keep.add(node);
    return wanted;
  };
  for (const scene of root.listScenes()) {
    for (const node of scene.listChildren()) visit(node);
  }

  for (const node of root.listNodes()) {
    if (!keep.has(node)) node.dispose();
  }

  for (const mesh of root.listMeshes()) {
    if (mesh.listParents().every((p: any) => p.propertyType === 'Root')) {
      for (const prim of mesh.listPrimitives()) prim.dispose();
      mesh.dispose();
    }
  }

  for (let pass = 0; pass < 2; pass++) {
    for (const a of root.listAccessors())
      if (a.listParents().every((p: any) => p.propertyType === 'Root')) a.dispose();
    for (const m of root.listMaterials())
      if (m.listParents().every((p: any) => p.propertyType === 'Root')) m.dispose();
    for (const t of root.listTextures())
      if (t.listParents().every((p: any) => p.propertyType === 'Root')) t.dispose();
  }

  const meshCount = root.listMeshes().length;
  const data = await io.writeBinary(doc);
  return { data, meshCount };
}
