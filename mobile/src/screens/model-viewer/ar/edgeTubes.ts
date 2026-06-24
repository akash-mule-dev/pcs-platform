// Pure geometry: turn wireframe edge segments into thin square-tube TRIANGLE
// meshes. No imports — directly unit-testable (see __tests__/edgeTubes.test.ts).
//
// This is the crux of the AR edge view: Viro/ViroCore does NOT render glTF LINES
// primitives, so the old line-based wireframe was invisible in AR. Each edge here
// becomes a 4-sided prism (8 verts, 8 triangles) that renders everywhere and
// reads as a crisp edge from any angle.

export interface TubeGeometry {
  positions: Float32Array;
  indices: Uint32Array;
}

/**
 * @param edgeEndpoints flat [ax,ay,az, bx,by,bz, …] segment pairs
 * @param radius half-thickness in model units
 */
export function buildEdgeTubes(edgeEndpoints: number[], radius: number): TubeGeometry {
  const edgeCount = Math.floor(edgeEndpoints.length / 6);
  const positions = new Float32Array(edgeCount * 8 * 3);
  const indices = new Uint32Array(edgeCount * 8 * 3); // 8 triangles × 3
  let vp = 0; // float cursor into positions
  let ip = 0; // index cursor
  for (let e = 0; e < edgeCount; e++) {
    const o = e * 6;
    const ax = edgeEndpoints[o], ay = edgeEndpoints[o + 1], az = edgeEndpoints[o + 2];
    const bx = edgeEndpoints[o + 3], by = edgeEndpoints[o + 4], bz = edgeEndpoints[o + 5];
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    // Perpendicular basis (u, v) around edge direction d. Pick a reference axis
    // not parallel to d (avoid the degenerate cross product when d ≈ ±Y).
    const refX = Math.abs(dy) > 0.99 ? 1 : 0;
    const refY = Math.abs(dy) > 0.99 ? 0 : 1;
    // u = normalize(d × ref)
    let ux = dy * 0 - dz * refY;
    let uy = dz * refX - dx * 0;
    let uz = dx * refY - dy * refX;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    // v = d × u (already unit-length since d ⟂ u and both unit)
    const vx = dy * uz - dz * uy;
    const vy = dz * ux - dx * uz;
    const vz = dx * uy - dy * ux;
    const corners = [
      [ux + vx, uy + vy, uz + vz],
      [ux - vx, uy - vy, uz - vz],
      [-ux - vx, -uy - vy, -uz - vz],
      [-ux + vx, -uy + vy, -uz + vz],
    ];
    const vBase = e * 8;
    for (let c = 0; c < 4; c++) {
      positions[vp++] = ax + corners[c][0] * radius;
      positions[vp++] = ay + corners[c][1] * radius;
      positions[vp++] = az + corners[c][2] * radius;
    }
    for (let c = 0; c < 4; c++) {
      positions[vp++] = bx + corners[c][0] * radius;
      positions[vp++] = by + corners[c][1] * radius;
      positions[vp++] = bz + corners[c][2] * radius;
    }
    for (let c = 0; c < 4; c++) {
      const c0 = vBase + c;
      const c1 = vBase + ((c + 1) % 4);
      const c0b = c0 + 4;
      const c1b = c1 + 4;
      indices[ip++] = c0; indices[ip++] = c1; indices[ip++] = c1b;
      indices[ip++] = c0; indices[ip++] = c1b; indices[ip++] = c0b;
    }
  }
  return { positions, indices };
}
