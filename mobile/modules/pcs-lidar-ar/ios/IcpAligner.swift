// Point-to-plane ICP for the LiDAR auto-snap (Phase 3). Pure numerics over plain
// SIMD arrays — no ARKit/RealityKit deps — so it's isolated and reviewable. The
// caller (PcsLidarArView) gathers model surface points + real-mesh points/normals
// (all WORLD space) and applies the returned correction ONLY if it actually
// lowers the residual (the view's revert-if-not-better guard), so a poor fit can
// never make alignment worse.
//
// This is a LOCAL refinement: it expects the model already roughly aligned (drag /
// point-pair) and pulls it onto the scanned surface. It does not do global
// registration (symmetric steel would be ambiguous).
import simd

enum IcpAligner {
  struct Result {
    let transform: simd_float4x4 // world correction T: maps current model points → aligned
    let initialRmsM: Float
    let finalRmsM: Float
    let inlierRatio: Float
    let iterations: Int
    let converged: Bool
  }

  // Spatial hash over the real-mesh points for O(1)-ish nearest lookup.
  private struct VoxelGrid {
    let cell: Float
    let points: [SIMD3<Float>]
    private var buckets: [Int64: [Int]] = [:]

    init(points: [SIMD3<Float>], cell: Float) {
      self.cell = cell
      self.points = points
      for (i, p) in points.enumerated() { buckets[Self.hash(p, cell), default: []].append(i) }
    }

    private static func hash(_ p: SIMD3<Float>, _ cell: Float) -> Int64 {
      let x = Int64((p.x / cell).rounded(.down))
      let y = Int64((p.y / cell).rounded(.down))
      let z = Int64((p.z / cell).rounded(.down))
      return (x &* 73_856_093) ^ (y &* 19_349_663) ^ (z &* 83_492_791)
    }

    // Nearest point index within maxDist (searches the cells covering that radius).
    func nearest(_ q: SIMD3<Float>, maxDist: Float) -> Int? {
      let cx = Int64((q.x / cell).rounded(.down))
      let cy = Int64((q.y / cell).rounded(.down))
      let cz = Int64((q.z / cell).rounded(.down))
      let r = Int64((maxDist / cell).rounded(.up))
      var best = -1
      var bestD = maxDist * maxDist
      var dx = -r
      while dx <= r {
        var dy = -r
        while dy <= r {
          var dz = -r
          while dz <= r {
            let key = ((cx + dx) &* 73_856_093) ^ ((cy + dy) &* 19_349_663) ^ ((cz + dz) &* 83_492_791)
            if let idxs = buckets[key] {
              for i in idxs {
                let d = simd_distance_squared(points[i], q)
                if d < bestD { bestD = d; best = i }
              }
            }
            dz += 1
          }
          dy += 1
        }
        dx += 1
      }
      return best >= 0 ? best : nil
    }
  }

  static func solve(
    modelPoints: [SIMD3<Float>],
    realPoints: [SIMD3<Float>],
    realNormals: [SIMD3<Float>],
    maxIterations: Int = 20
  ) -> Result {
    let identity = matrix_identity_float4x4
    guard modelPoints.count >= 10, realPoints.count >= 30, realPoints.count == realNormals.count else {
      return Result(transform: identity, initialRmsM: .infinity, finalRmsM: .infinity, inlierRatio: 0, iterations: 0, converged: false)
    }

    let grid = VoxelGrid(points: realPoints, cell: 0.05)
    var pts = modelPoints
    var total = identity
    var threshold: Float = 0.10
    let thresholdFloor: Float = 0.03
    let iterCap = maxIterations

    // Accept/revert metric: a TRUNCATED point-to-plane cost at a FIXED gate radius,
    // measured over ALL model points (constant denominator). Initial vs final is
    // then apples-to-apples — it can't be gamed by the ICP correspondence threshold
    // shrinking (the bug a naïve per-threshold RMS has).
    let gateT: Float = 0.06
    let searchR: Float = 0.5
    let initial = robustCost(pts, grid, realPoints, realNormals, truncate: gateT, searchRadius: searchR)
    var converged = false
    var iter = 0

    while iter < iterCap {
      iter += 1
      // Accumulate the point-to-plane normal equations: for each correspondence
      // a·x = b with a = [pt×n, n], b = -(p−q)·n, x = [rotationVec(3), translation(3)].
      var ata = [[Double]](repeating: [Double](repeating: 0, count: 6), count: 6)
      var atb = [Double](repeating: 0, count: 6)
      var inliers = 0
      for p in pts {
        guard let j = grid.nearest(p, maxDist: threshold) else { continue }
        let n = realNormals[j]
        let r = simd_dot(p - realPoints[j], n)
        let c = simd_cross(p, n)
        let a = [Double(c.x), Double(c.y), Double(c.z), Double(n.x), Double(n.y), Double(n.z)]
        let b = Double(-r)
        for i in 0..<6 {
          for k in 0..<6 { ata[i][k] += a[i] * a[k] }
          atb[i] += a[i] * b
        }
        inliers += 1
      }
      if inliers < 6 { break }
      guard let x = solve6(ata, atb) else { break }

      let rot = SIMD3<Float>(Float(x[0]), Float(x[1]), Float(x[2]))
      let trans = SIMD3<Float>(Float(x[3]), Float(x[4]), Float(x[5]))
      if !rot.x.isFinite || !trans.x.isFinite { break }
      let inc = makeTransform(rotationVector: rot, translation: trans)
      for i in 0..<pts.count {
        let v = inc * SIMD4<Float>(pts[i], 1)
        pts[i] = SIMD3<Float>(v.x, v.y, v.z)
      }
      total = inc * total
      threshold = max(thresholdFloor, threshold * 0.85)
      if simd_length(rot) < 1e-4 && simd_length(trans) < 1e-4 { converged = true; break }
    }

    let final = robustCost(pts, grid, realPoints, realNormals, truncate: gateT, searchRadius: searchR)
    return Result(
      transform: total,
      initialRmsM: initial.cost,
      finalRmsM: final.cost,
      inlierRatio: final.inlierRatio,
      iterations: iter,
      converged: converged
    )
  }

  // Truncated point-to-plane cost: RMS of min(residual, T) over EVERY model point
  // (a point with no neighbour within searchRadius contributes the full T). The
  // constant point count + fixed truncation make this a sound accept/revert metric
  // (moving points onto the surface strictly lowers it; it can't be lowered by the
  // correspondence set shrinking). Also returns the ≤T inlier fraction.
  private static func robustCost(
    _ pts: [SIMD3<Float>],
    _ grid: VoxelGrid,
    _ realPts: [SIMD3<Float>],
    _ normals: [SIMD3<Float>],
    truncate T: Float,
    searchRadius: Float
  ) -> (cost: Float, inlierRatio: Float) {
    let t2 = Double(T) * Double(T)
    var sum: Double = 0
    var inliers = 0
    for p in pts {
      var c = t2
      if let j = grid.nearest(p, maxDist: searchRadius) {
        let r = simd_dot(p - realPts[j], normals[j])
        c = min(Double(r) * Double(r), t2)
        if abs(r) <= T { inliers += 1 }
      }
      sum += c
    }
    let cost = Float((sum / Double(pts.count)).squareRoot())
    return (cost, Float(inliers) / Float(pts.count))
  }

  // 4×4 rigid transform from a small-angle rotation vector (axis·angle) + translation.
  private static func makeTransform(rotationVector v: SIMD3<Float>, translation t: SIMD3<Float>) -> simd_float4x4 {
    let angle = simd_length(v)
    let rot3: simd_float3x3
    if angle < 1e-8 {
      rot3 = matrix_identity_float3x3
    } else {
      rot3 = simd_float3x3(simd_quatf(angle: angle, axis: v / angle))
    }
    var m = matrix_identity_float4x4
    m.columns.0 = SIMD4<Float>(rot3.columns.0, 0)
    m.columns.1 = SIMD4<Float>(rot3.columns.1, 0)
    m.columns.2 = SIMD4<Float>(rot3.columns.2, 0)
    m.columns.3 = SIMD4<Float>(t, 1)
    return m
  }

  // Solve a 6×6 linear system by Gauss-Jordan elimination with partial pivoting.
  private static func solve6(_ Ain: [[Double]], _ bin: [Double]) -> [Double]? {
    var A = Ain
    var b = bin
    let n = 6
    for col in 0..<n {
      var piv = col
      for r in (col + 1)..<n where abs(A[r][col]) > abs(A[piv][col]) { piv = r }
      if abs(A[piv][col]) < 1e-12 { return nil }
      if piv != col { A.swapAt(piv, col); b.swapAt(piv, col) }
      for r in 0..<n where r != col {
        let f = A[r][col] / A[col][col]
        if f == 0 { continue }
        for c in col..<n { A[r][c] -= f * A[col][c] }
        b[r] -= f * b[col]
      }
    }
    var x = [Double](repeating: 0, count: n)
    for i in 0..<n { x[i] = b[i] / A[i][i] }
    return x
  }
}
