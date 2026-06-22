import { buildEdgeTubes } from '../ar/edgeTubes';

describe('buildEdgeTubes (AR edge geometry)', () => {
  it('produces 8 verts + 8 triangles of solid geometry per edge', () => {
    // Two edges along different axes (incl. the ±Y degenerate-basis case).
    const edges = [
      0, 0, 0, 1, 0, 0, // along X
      0, 0, 0, 0, 1, 0, // along Y (basis-reference switch path)
    ];
    const { positions, indices } = buildEdgeTubes(edges, 0.01);
    expect(positions.length).toBe(2 * 8 * 3);
    expect(indices.length).toBe(2 * 8 * 3); // 8 triangles × 3 per edge
  });

  it('keeps every index in range and every position finite', () => {
    const edges = [
      0, 0, 0, 1, 0, 0,
      0, 0, 0, 0, 1, 0,
      0, 0, 0, 0, 0, 1,
      1, 2, 3, -4, 5, -6, // arbitrary diagonal
    ];
    const { positions, indices } = buildEdgeTubes(edges, 0.02);
    const vertCount = positions.length / 3;
    let maxIdx = 0;
    for (let i = 0; i < indices.length; i++) maxIdx = Math.max(maxIdx, indices[i]);
    expect(maxIdx).toBeLessThan(vertCount);
    for (let i = 0; i < positions.length; i++) expect(Number.isFinite(positions[i])).toBe(true);
  });

  it('builds the tube AROUND the edge — verts straddle the segment within ~radius', () => {
    const r = 0.05;
    const { positions } = buildEdgeTubes([0, 0, 0, 1, 0, 0], r); // edge along +X
    // The 8 corner verts sit at x≈0 or x≈1 (ring planes) and within r of the
    // axis in y/z, on both sides (so the tube encloses the edge, not offset).
    let minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i], y = positions[i + 1], z = positions[i + 2];
      expect(x).toBeGreaterThanOrEqual(-1e-6);
      expect(x).toBeLessThanOrEqual(1 + 1e-6);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    // straddles the axis on both sides in the perpendicular plane
    expect(minY).toBeLessThan(0);
    expect(maxY).toBeGreaterThan(0);
    expect(minZ).toBeLessThan(0);
    expect(maxZ).toBeGreaterThan(0);
    // within the tube radius (diagonal of square cross-section ≈ r·√2)
    expect(maxY).toBeLessThanOrEqual(r * 1.5);
  });

  it('handles empty input', () => {
    const { positions, indices } = buildEdgeTubes([], 0.01);
    expect(positions.length).toBe(0);
    expect(indices.length).toBe(0);
  });
});
