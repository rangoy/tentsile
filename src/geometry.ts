import type {
  CheckResult,
  ComboResult,
  FitResult,
  OtherTreePoint,
  Point,
  Settings,
  TreeEntry,
  TreeInputs,
  TreeLabels,
  TriangleSolution,
} from './types'

export const ANGLE_OK_MAX = 80
export const ANGLE_TIGHT_MAX = 100
export const DEFAULT_TRUNK_DIAMETER = 0.4
export const MIN_TRUNK_DIAMETER = 0.3
export const BEND_OK_MAX = 2
export const BEND_TIGHT_MAX = 7
export const MIN_TREES = 3
export const MAX_TREES = 8

const DEG = 180 / Math.PI

const DEFAULT_LABELS: TreeLabels = { A: '1', B: '2', C: '3' }

function distance(p: Point, q: Point): number {
  return Math.hypot(p.x - q.x, p.y - q.y)
}

/** A tree's display identity is its 1-based position, plus its optional label in parens. */
export function formatTreeDisplay(position: number, label: string): string {
  const trimmed = label.trim()
  return trimmed ? `${position} (${trimmed})` : `${position}`
}

/**
 * Reconstructs the 2D positions of trees A, B, C from the three measured
 * tree-to-tree distances, and derives the interior angle at each vertex.
 * A is placed at the origin, B along +x, C solved via the law of cosines.
 */
export function solveTriangle(inputs: TreeInputs): TriangleSolution {
  const { dAB, dBC, dCA } = inputs
  const origin = { x: 0, y: 0 }

  if (dAB <= 0 || dBC <= 0 || dCA <= 0) {
    return {
      valid: false,
      reason: 'All three distances must be greater than zero.',
      A: origin,
      B: origin,
      C: origin,
      angleA: 0,
      angleB: 0,
      angleC: 0,
    }
  }

  const violatesTriangleInequality =
    dAB + dBC <= dCA || dBC + dCA <= dAB || dCA + dAB <= dBC

  if (violatesTriangleInequality) {
    return {
      valid: false,
      reason:
        "These three distances can't form a triangle (one side is longer than the other two combined).",
      A: origin,
      B: origin,
      C: origin,
      angleA: 0,
      angleB: 0,
      angleC: 0,
    }
  }

  // Law of cosines: angle at vertex is opposite the side named by the other two vertices.
  const angleA = Math.acos((dAB ** 2 + dCA ** 2 - dBC ** 2) / (2 * dAB * dCA))
  const angleB = Math.acos((dAB ** 2 + dBC ** 2 - dCA ** 2) / (2 * dAB * dBC))
  const angleC = Math.acos((dBC ** 2 + dCA ** 2 - dAB ** 2) / (2 * dBC * dCA))

  const A: Point = { x: 0, y: 0 }
  const B: Point = { x: dAB, y: 0 }
  const C: Point = { x: dCA * Math.cos(angleA), y: dCA * Math.sin(angleA) }

  return {
    valid: true,
    A,
    B,
    C,
    angleA: angleA * DEG,
    angleB: angleB * DEG,
    angleC: angleC * DEG,
  }
}

/**
 * Finds the Fermat (Torricelli) point of a triangle: the point from which all
 * three vertices are seen 120° apart from one another. This is the unique
 * position (when every interior angle is under 120°, which our own angle
 * checks already require to be under 100°) that lets the tent's rigid,
 * 120°-apart corners each point exactly at their tree — i.e. zero bend
 * between the tent's center-to-corner spoke and the corner-to-tree strap.
 *
 * Solved via Weiszfeld's algorithm (iterative geometric median), which
 * converges to this same point for any triangle with all angles under 120°.
 */
function fermatPoint(trees: Point[]): Point {
  let point: Point = {
    x: (trees[0].x + trees[1].x + trees[2].x) / 3,
    y: (trees[0].y + trees[1].y + trees[2].y) / 3,
  }
  const EPSILON = 1e-9
  for (let iter = 0; iter < 200; iter++) {
    let wx = 0
    let wy = 0
    let wsum = 0
    for (const tree of trees) {
      const d = Math.max(distance(point, tree), EPSILON)
      wx += tree.x / d
      wy += tree.y / d
      wsum += 1 / d
    }
    point = { x: wx / wsum, y: wy / wsum }
  }
  return point
}

/**
 * The rotation (radians) of a rigid, 120°-apart tent triangle centered at
 * `center` that minimizes total squared corner-to-tree distance. Exact
 * closed form (see the geometry.ts history for the derivation): writing each
 * corner as center + R*e^{i(theta+phi_i)} and v_i = center - tree_i, the sum
 * of squared distances is minimized at theta = pi - arg(W), where
 * W = sum_i conj(v_i) * e^{i*phi_i}. At the Fermat point specifically this
 * reaches exactly zero (0° bend at all three corners); off that point it's
 * merely the best available rotation, generally leaving some bend.
 */
function optimalRotation(center: Point, trees: Point[], phis: number[]): number {
  let wx = 0
  let wy = 0
  for (let i = 0; i < trees.length; i++) {
    const vix = center.x - trees[i].x
    const viy = center.y - trees[i].y
    const cosPhi = Math.cos(phis[i])
    const sinPhi = Math.sin(phis[i])
    wx += vix * cosPhi + viy * sinPhi
    wy += vix * sinPhi - viy * cosPhi
  }
  return Math.PI - Math.atan2(wy, wx)
}

function cornerPositions(center: Point, theta: number, phis: number[], radius: number): Point[] {
  return phis.map((phi) => ({
    x: center.x + radius * Math.cos(theta + phi),
    y: center.y + radius * Math.sin(theta + phi),
  }))
}

function evaluateCenter(center: Point, trees: Point[], phis: number[], radius: number) {
  const theta = optimalRotation(center, trees, phis)
  const corners = cornerPositions(center, theta, phis, radius)
  const bends = corners.map((corner, i) => angleBetweenVectors(center, corner, corner, trees[i]))
  const overshoot = trees.map((tree) => distance(center, tree) < radius)
  const sumSquaredBend = bends.reduce((sum, b) => sum + b * b, 0)
  return { center, theta, corners, bends, overshoot, sumSquaredBend }
}

type CenterCandidate = ReturnType<typeof evaluateCenter>

/**
 * Local pattern-search refinement of the tent's center, starting from
 * `initial` (typically the Fermat-point-anchored placement `placeTent`
 * already found). The Fermat point only guarantees zero bend at every
 * corner when the tent's own corners are 120° apart (an equilateral tent);
 * for any other shape it's just a reasonable starting guess, and nudging
 * the center can noticeably reduce the worst bend (e.g. shortening an
 * overly long "tip" strap tightens the other two straps' alignment). Never
 * accepts a move that overshoots a tree the starting point didn't already
 * overshoot, so it can't undo `placeTent`'s overshoot-avoidance work. A
 * no-op for an equilateral tent at the true Fermat point: 0° bend at every
 * corner is already the global minimum of the sum-of-squares objective, so
 * no nearby move can improve on it.
 */
function refineCenter(initial: CenterCandidate, trees: Point[], phis: number[], radius: number): CenterCandidate {
  let best = initial
  let step = radius * 0.5
  const MIN_STEP = radius * 1e-5
  const directions = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ]
  while (step > MIN_STEP) {
    let improved = false
    for (const dir of directions) {
      const candidate = evaluateCenter(
        { x: best.center.x + dir.x * step, y: best.center.y + dir.y * step },
        trees,
        phis,
        radius,
      )
      const introducesOvershoot = candidate.overshoot.some((o, i) => o && !best.overshoot[i])
      if (introducesOvershoot || candidate.sumSquaredBend >= best.sumSquaredBend) continue
      best = candidate
      improved = true
    }
    if (!improved) step /= 2
  }
  return best
}

/**
 * Places the tent's center. The Fermat point gives an exact zero-bend fit
 * for an equilateral tent, but for some triangle shapes it sits closer to
 * one tree than the tent's own circumradius — the corner would then
 * overshoot past that tree entirely, which is physically nonsensical (the
 * strap can't pass through the trunk). When that happens, this blends the
 * center back toward the triangle's centroid (a more conservative,
 * "average" position that's less prone to sitting inside the tent's own
 * radius) just far enough to clear every tree, using up to the same 7°
 * bend tolerance the per-corner bend check already allows before giving up
 * and falling back to the centroid itself. Either way, a final local
 * refinement (see `refineCenter`) squeezes out any further bend reduction
 * available for tent shapes where zero bend isn't achievable everywhere.
 */
function placeTent(
  trees: Point[],
  phis: number[],
  radius: number,
): { center: Point; theta: number; corners: Point[]; overshoot: boolean[] } {
  const fermat = fermatPoint(trees)
  const centroid = {
    x: (trees[0].x + trees[1].x + trees[2].x) / 3,
    y: (trees[0].y + trees[1].y + trees[2].y) / 3,
  }

  const STEPS = 24
  let fallback = evaluateCenter(centroid, trees, phis, radius)
  let accepted: CenterCandidate | null = null
  for (let step = 0; step <= STEPS; step++) {
    const t = 1 - step / STEPS
    const candidate = evaluateCenter(
      { x: centroid.x + t * (fermat.x - centroid.x), y: centroid.y + t * (fermat.y - centroid.y) },
      trees,
      phis,
      radius,
    )
    if (candidate.overshoot.every((o) => !o) && candidate.bends.every((b) => b <= BEND_TIGHT_MAX)) {
      accepted = candidate
      break
    }
    fallback = candidate // keep the closest-to-centroid attempt as a last resort
  }
  return refineCenter(accepted ?? fallback, trees, phis, radius)
}

/** Angle (0-180°) between vectors (b-a) and (d-c). */
function angleBetweenVectors(a: Point, b: Point, c: Point, d: Point): number {
  const v1 = Math.atan2(b.y - a.y, b.x - a.x)
  const v2 = Math.atan2(d.y - c.y, d.x - c.x)
  let diff = Math.abs(v1 - v2) * DEG
  if (diff > 180) diff = 360 - diff
  return diff
}

function checkStatusRank(status: CheckResult['status']): number {
  return status === 'fail' ? 2 : status === 'tight' ? 1 : 0
}

/** The center of the circle passing through all three points (closed form via perpendicular bisectors). */
function circumcenter(a: Point, b: Point, c: Point): Point {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y))
  const aSq = a.x ** 2 + a.y ** 2
  const bSq = b.x ** 2 + b.y ** 2
  const cSq = c.x ** 2 + c.y ** 2
  return {
    x: (aSq * (b.y - c.y) + bSq * (c.y - a.y) + cSq * (a.y - b.y)) / d,
    y: (aSq * (c.x - b.x) + bSq * (a.x - c.x) + cSq * (b.x - a.x)) / d,
  }
}

interface TentShape {
  valid: boolean
  reason?: string
  /** the tent's own 3 corners in its local frame, at 3 fixed "roles" (not tied to any tree yet) */
  corners: [Point, Point, Point]
  /** circumradius — the fixed center-to-corner distance, same for all 3 corners */
  radius: number
  /** each corner's fixed bearing from the tent's own circumcenter */
  phis: [number, number, number]
}

/**
 * Solves the tent's own fixed floor shape: an isosceles triangle (two equal
 * "leg" sides, one possibly-shorter "base" side — an equilateral tent like
 * the Stingray is just the case where base equals the legs too). Reuses
 * `solveTriangle` on the tent's own side lengths to get its 3 corners, then
 * finds their circumcenter to get the fixed radius/bearings that `placeTent`
 * needs (generalizing the old hardcoded 120°-apart/`tentSide / sqrt(3)`
 * equilateral shortcut to any triangle shape).
 */
function solveTentShape(settings: Settings): TentShape {
  const { tentLegLength: leg, tentBaseLength: base } = settings
  const shape = solveTriangle({ dAB: leg, dBC: leg, dCA: base, diameterA: null, diameterB: null, diameterC: null })
  const corners: [Point, Point, Point] = [shape.A, shape.B, shape.C]
  if (!shape.valid) {
    return { valid: false, reason: shape.reason, corners, radius: 0, phis: [0, 0, 0] }
  }
  const center = circumcenter(corners[0], corners[1], corners[2])
  const radius = distance(center, corners[0])
  const phis = corners.map((c) => Math.atan2(c.y - center.y, c.x - center.x)) as [number, number, number]
  return { valid: true, corners, radius, phis }
}

/**
 * The 6 ways to assign the tent's 3 fixed corner roles to trees A/B/C.
 * `PERMUTATIONS_3[k][t]` is the tent-corner-role index assigned to tree `t`.
 * For an equilateral tent all 6 give an identical result; for an isosceles
 * one, only the 3 matching the tent's own chirality can reach a good fit —
 * a physical tent can be rotated in place but not mirrored (that would
 * flip it upside down), so the other 3 simply score worse and lose.
 */
const PERMUTATIONS_3: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
]

export function computeFit(
  inputs: TreeInputs,
  settings: Settings,
  labels: TreeLabels = DEFAULT_LABELS,
): FitResult {
  const triangle = solveTriangle(inputs)
  const checks: CheckResult[] = []

  if (!triangle.valid) {
    checks.push({
      id: 'triangle',
      label: 'Valid triangle',
      status: 'fail',
      detail: triangle.reason ?? 'Invalid triangle.',
      margin: -1,
    })
    return {
      triangle,
      center: { x: 0, y: 0 },
      theta: 0,
      cornerA: { x: 0, y: 0 },
      cornerB: { x: 0, y: 0 },
      cornerC: { x: 0, y: 0 },
      strapA: 0,
      strapB: 0,
      strapC: 0,
      ratchetA: 0,
      ratchetB: 0,
      ratchetC: 0,
      checks,
      overallVerdict: 'fail',
    }
  }

  const { A, B, C } = triangle
  const trees = [A, B, C]

  const tentShape = solveTentShape(settings)
  if (!tentShape.valid) {
    checks.push({
      id: 'tentShape',
      label: 'Valid tent shape',
      status: 'fail',
      detail: tentShape.reason ?? 'Invalid tent shape.',
      margin: -1,
    })
    return {
      triangle,
      center: { x: 0, y: 0 },
      theta: 0,
      cornerA: { x: 0, y: 0 },
      cornerB: { x: 0, y: 0 },
      cornerC: { x: 0, y: 0 },
      strapA: 0,
      strapB: 0,
      strapC: 0,
      ratchetA: 0,
      ratchetB: 0,
      ratchetC: 0,
      checks,
      overallVerdict: 'fail',
    }
  }
  const { corners: tentCorners, radius, phis: basePhis } = tentShape

  // Which tree plays which of the tent's 3 fixed corner roles matters once
  // the tent isn't equilateral (see PERMUTATIONS_3) — try all 6 and keep
  // whichever assignment overshoots the fewest trees, then bends the least
  // (Fermat point when it fits without overshooting any tree; otherwise
  // blended back toward the centroid just far enough to clear every tree,
  // within the same 7° bend tolerance the per-corner bend check allows —
  // see placeTent).
  let best: { center: Point; theta: number; corners: Point[]; overshoot: boolean[]; perm: readonly [number, number, number]; overshootCount: number; maxBend: number } | null = null
  for (const perm of PERMUTATIONS_3) {
    const phis = perm.map((role) => basePhis[role])
    const candidate = placeTent(trees, phis, radius)
    const bends = candidate.corners.map((corner, i) => angleBetweenVectors(candidate.center, corner, corner, trees[i]))
    const overshootCount = candidate.overshoot.filter(Boolean).length
    const maxBend = Math.max(...bends)
    if (!best || overshootCount < best.overshootCount || (overshootCount === best.overshootCount && maxBend < best.maxBend)) {
      best = { ...candidate, perm, overshootCount, maxBend }
    }
  }
  const { center, theta, corners, overshoot, perm } = best!
  const [cornerA, cornerB, cornerC] = corners

  // The tent's own fixed edge length between the corners assigned to each
  // pair of trees — needed for the per-edge max-distance rule of thumb below,
  // which no longer assumes every tent edge is the same length.
  const tentEdgeLength = (i: number, j: number) => distance(tentCorners[perm[i]], tentCorners[perm[j]])
  const tentSideAB = tentEdgeLength(0, 1)
  const tentSideBC = tentEdgeLength(1, 2)
  const tentSideCA = tentEdgeLength(2, 0)

  const diameterA = inputs.diameterA ?? DEFAULT_TRUNK_DIAMETER
  const diameterB = inputs.diameterB ?? DEFAULT_TRUNK_DIAMETER
  const diameterC = inputs.diameterC ?? DEFAULT_TRUNK_DIAMETER
  const circumferenceA = Math.PI * diameterA
  const circumferenceB = Math.PI * diameterB
  const circumferenceC = Math.PI * diameterC

  // Strap length is the raw geometric reach from the (Fermat-point-positioned)
  // tent corner to the tree — verified against a reference implementation
  // (Tentsile Triangulator) that reports exactly this raw reach. Neither the
  // tail/tether length nor trunk circumference is subtracted from it; trunk
  // thickness still factors into the max-distance check below, and the tail
  // is handled separately (see "Tail fit" checks) since it's a fixed segment
  // between the tent corner and the ratchet buckle, not part of the ratchet
  // strap's own adjustable length.
  const strapA = distance(cornerA, A)
  const strapB = distance(cornerB, B)
  const strapC = distance(cornerC, C)

  // Portion of the reach left for the adjustable ratchet strap once the fixed
  // tail is accounted for. Negative means the tree is closer than the tail
  // itself reaches — a basket loop (skip the tail, loop the strap directly
  // around the trunk) is needed instead of the standard tail+ratchet setup.
  const ratchetA = strapA - settings.tailLength
  const ratchetB = strapB - settings.tailLength
  const ratchetC = strapC - settings.tailLength

  // --- Distance checks (min/max tree-to-tree spacing) ---
  const edges: Array<{
    id: string
    label: string
    dist: number
    circumSum: number
    tentSide: number
  }> = [
    { id: 'edgeAB', label: `${labels.A} ↔ ${labels.B}`, dist: inputs.dAB, circumSum: circumferenceA + circumferenceB, tentSide: tentSideAB },
    { id: 'edgeBC', label: `${labels.B} ↔ ${labels.C}`, dist: inputs.dBC, circumSum: circumferenceB + circumferenceC, tentSide: tentSideBC },
    { id: 'edgeCA', label: `${labels.C} ↔ ${labels.A}`, dist: inputs.dCA, circumSum: circumferenceC + circumferenceA, tentSide: tentSideCA },
  ]

  for (const edge of edges) {
    // Reach without leaning on the tail's extra length, vs. the true max once
    // both corners' fixed tails are counted too (each tail adds its own length
    // to that corner's reach, since the tail is in series with the ratchet strap).
    const maxDistNoTail = 2 * settings.strapMax + edge.tentSide - edge.circumSum
    const maxDist = maxDistNoTail + 2 * settings.tailLength
    // No hard minimum here: trees closer together are workable with a basket
    // loop (skip the tail, loop the strap directly around the trunk), which is
    // exactly what the per-corner "Tail fit" check below already flags — so
    // margin only tracks headroom below the max reach, not a lower bound.
    const margin = maxDist > 0 ? (maxDist - edge.dist) / maxDist : -1
    if (edge.dist > maxDist) {
      checks.push({
        id: edge.id,
        label: edge.label,
        status: 'fail',
        detail: `${edge.dist.toFixed(2)} m exceeds the ${maxDist.toFixed(2)} m max reach with a ${settings.strapMax.toFixed(1)} m strap and ${settings.tailLength.toFixed(2)} m tail.`,
        margin,
      })
    } else if (edge.dist > maxDistNoTail) {
      checks.push({
        id: edge.id,
        label: edge.label,
        status: 'tight',
        detail: `${edge.dist.toFixed(2)} m relies on the tail's reach (max without it: ${maxDistNoTail.toFixed(2)} m, with it: ${maxDist.toFixed(2)} m).`,
        margin,
      })
    } else {
      checks.push({
        id: edge.id,
        label: edge.label,
        status: 'pass',
        detail: `${edge.dist.toFixed(2)} m (max reach ${maxDistNoTail.toFixed(2)} m).`,
        margin,
      })
    }
  }

  // --- Angle checks ---
  const angles: Array<{ id: string; label: string; value: number }> = [
    { id: 'angleA', label: `Angle at ${labels.A}`, value: triangle.angleA },
    { id: 'angleB', label: `Angle at ${labels.B}`, value: triangle.angleB },
    { id: 'angleC', label: `Angle at ${labels.C}`, value: triangle.angleC },
  ]

  for (const angle of angles) {
    const margin = 1 - angle.value / ANGLE_TIGHT_MAX
    if (angle.value > ANGLE_TIGHT_MAX) {
      checks.push({
        id: angle.id,
        label: angle.label,
        status: 'fail',
        detail: `${angle.value.toFixed(0)}° is too wide — consider a floating anchor or a different tree.`,
        margin,
      })
    } else if (angle.value > ANGLE_OK_MAX) {
      checks.push({
        id: angle.id,
        label: angle.label,
        status: 'tight',
        detail: `${angle.value.toFixed(0)}° is a tight fit — offset the strap to the side of the trunk to shave off the angle.`,
        margin,
      })
    } else {
      checks.push({
        id: angle.id,
        label: angle.label,
        status: 'pass',
        detail: `${angle.value.toFixed(0)}°`,
        margin,
      })
    }
  }

  // --- Trunk diameter checks (only if the user supplied a value) ---
  const trunks: Array<{ id: string; label: string; value: number | null }> = [
    { id: 'trunkA', label: `${labels.A} trunk`, value: inputs.diameterA },
    { id: 'trunkB', label: `${labels.B} trunk`, value: inputs.diameterB },
    { id: 'trunkC', label: `${labels.C} trunk`, value: inputs.diameterC },
  ]
  for (const trunk of trunks) {
    if (trunk.value === null) continue
    const margin = (trunk.value - MIN_TRUNK_DIAMETER) / MIN_TRUNK_DIAMETER
    if (trunk.value < MIN_TRUNK_DIAMETER) {
      checks.push({
        id: trunk.id,
        label: trunk.label,
        status: 'fail',
        detail: `${(trunk.value * 100).toFixed(0)} cm is below the recommended ${(MIN_TRUNK_DIAMETER * 100).toFixed(0)} cm minimum.`,
        margin,
      })
    } else {
      checks.push({
        id: trunk.id,
        label: trunk.label,
        status: 'pass',
        detail: `${(trunk.value * 100).toFixed(0)} cm diameter.`,
        margin,
      })
    }
  }

  // --- Strap length checks ---
  // The strapMax setting is the ratchet strap's own max length — it doesn't
  // include the fixed tail, which is separate hardware in series with it. So
  // the limit applies to the ratchet-only portion, not the raw total reach.
  const straps: Array<{ id: string; label: string; strap: number; ratchet: number }> = [
    { id: 'strapA', label: `Strap to ${labels.A}`, strap: strapA, ratchet: ratchetA },
    { id: 'strapB', label: `Strap to ${labels.B}`, strap: strapB, ratchet: ratchetB },
    { id: 'strapC', label: `Strap to ${labels.C}`, strap: strapC, ratchet: ratchetC },
  ]
  for (const strap of straps) {
    const margin = (settings.strapMax - strap.ratchet) / settings.strapMax
    if (strap.ratchet > settings.strapMax) {
      checks.push({
        id: strap.id,
        label: strap.label,
        status: 'fail',
        detail:
          settings.tailLength > 0
            ? `${strap.ratchet.toFixed(2)} m of ratchet strap needed (after the ${settings.tailLength.toFixed(2)} m tail), longer than your ${settings.strapMax.toFixed(1)} m strap.`
            : `${strap.strap.toFixed(2)} m needed, longer than your ${settings.strapMax.toFixed(1)} m strap.`,
        margin,
      })
    } else {
      checks.push({
        id: strap.id,
        label: strap.label,
        status: 'pass',
        detail: `${strap.strap.toFixed(2)} m needed.`,
        margin,
      })
    }
  }

  // --- Tail fit checks (only meaningful once a tail/tether length is set) ---
  if (settings.tailLength > 0) {
    const tails: Array<{ id: string; label: string; ratchet: number }> = [
      { id: 'tailA', label: `Tail fit at ${labels.A}`, ratchet: ratchetA },
      { id: 'tailB', label: `Tail fit at ${labels.B}`, ratchet: ratchetB },
      { id: 'tailC', label: `Tail fit at ${labels.C}`, ratchet: ratchetC },
    ]
    for (const tail of tails) {
      const margin = tail.ratchet / settings.tailLength
      if (tail.ratchet < 0) {
        checks.push({
          id: tail.id,
          label: tail.label,
          status: 'tight',
          detail: `Tree is closer than the ${settings.tailLength.toFixed(2)} m tail — use a basket loop (loop the strap directly around the tree, skipping the tail) instead.`,
          margin,
        })
      } else {
        checks.push({
          id: tail.id,
          label: tail.label,
          status: 'pass',
          detail: `${tail.ratchet.toFixed(2)} m of ratchet strap needed after the ${settings.tailLength.toFixed(2)} m tail.`,
          margin,
        })
      }
    }
  }

  // --- Bend checks (deviation of each strap from its center-to-corner spoke) ---
  const bends: Array<{ id: string; label: string; corner: Point; tree: Point }> = [
    { id: 'bendA', label: `Strap bend at ${labels.A}`, corner: cornerA, tree: A },
    { id: 'bendB', label: `Strap bend at ${labels.B}`, corner: cornerB, tree: B },
    { id: 'bendC', label: `Strap bend at ${labels.C}`, corner: cornerC, tree: C },
  ]
  for (const bend of bends) {
    const angle = angleBetweenVectors(center, bend.corner, bend.corner, bend.tree)
    const margin = 1 - angle / BEND_TIGHT_MAX
    if (angle > BEND_TIGHT_MAX) {
      checks.push({
        id: bend.id,
        label: bend.label,
        status: 'fail',
        detail: `${angle.toFixed(1)}° off the tent's center line — beyond the ~7° of built-in strap tolerance.`,
        margin,
      })
    } else if (angle > BEND_OK_MAX) {
      checks.push({
        id: bend.id,
        label: bend.label,
        status: 'tight',
        detail: `${angle.toFixed(1)}° off the tent's center line — within the ~7° of built-in strap tolerance.`,
        margin,
      })
    } else {
      checks.push({
        id: bend.id,
        label: bend.label,
        status: 'pass',
        detail: `${angle.toFixed(1)}° off the tent's center line.`,
        margin,
      })
    }
  }

  // --- Tent-fit checks (does this corner overshoot past its own tree?) ---
  // placeTent already tries to avoid this by blending away from the Fermat
  // point (see placeTent) — this only fires when even the centroid fallback
  // can't clear every tree within the bend tolerance, meaning the tent is
  // simply too big for this triangle: no valid rotation keeps every corner
  // on the near side of its tree.
  const fits: Array<{ id: string; label: string; treeLabel: string; tree: Point; overshoot: boolean }> = [
    { id: 'fitA', label: `Tent fit at ${labels.A}`, treeLabel: labels.A, tree: A, overshoot: overshoot[0] },
    { id: 'fitB', label: `Tent fit at ${labels.B}`, treeLabel: labels.B, tree: B, overshoot: overshoot[1] },
    { id: 'fitC', label: `Tent fit at ${labels.C}`, treeLabel: labels.C, tree: C, overshoot: overshoot[2] },
  ]
  for (const fit of fits) {
    const clearance = distance(center, fit.tree) - radius
    const margin = clearance / radius
    if (fit.overshoot) {
      checks.push({
        id: fit.id,
        label: fit.label,
        status: 'fail',
        detail: `The tent's own size means this corner would sit beyond ${fit.treeLabel} — it doesn't fit this triangle even with the full bend tolerance.`,
        margin,
      })
    } else {
      checks.push({
        id: fit.id,
        label: fit.label,
        status: 'pass',
        detail: `${clearance.toFixed(2)} m of clearance before this corner would reach the tree.`,
        margin,
      })
    }
  }

  const overallVerdict = checks.reduce<CheckResult['status']>(
    (worst, c) => (checkStatusRank(c.status) > checkStatusRank(worst) ? c.status : worst),
    'pass',
  )

  return {
    triangle,
    center,
    theta,
    cornerA,
    cornerB,
    cornerC,
    strapA,
    strapB,
    strapC,
    ratchetA,
    ratchetB,
    ratchetC,
    checks,
    overallVerdict,
  }
}

/**
 * Reconstructs 2D positions for a grove of trees entered via baseline +
 * trilateration: reference tree `refA` is the origin, reference tree `refB`
 * sets the baseline along +x, and every other tree gives its distance to
 * both references plus which side of that baseline it's on. A tree with
 * invalid/missing distances gets a null position and an entry in `errors`;
 * every combination that references it is skipped rather than guessed at.
 */
export function buildTreePositions(
  trees: TreeEntry[],
  refA = 0,
  refB = 1,
): {
  positions: Array<Point | null>
  errors: string[]
} {
  const positions: Array<Point | null> = new Array(trees.length).fill(null)
  const errors: string[] = []

  if (trees.length === 0) return { positions, errors }
  if (refA === refB || !trees[refA] || !trees[refB]) {
    errors.push('Pick two different trees as references.')
    return { positions, errors }
  }

  positions[refA] = { x: 0, y: 0 }

  const baseline = trees[refB].distToFirst
  if (!(baseline > 0)) {
    errors.push(`${formatTreeDisplay(refB + 1, trees[refB].label)}: distance must be greater than zero.`)
  } else {
    positions[refB] = { x: baseline, y: 0 }
  }

  for (let i = 0; i < trees.length; i++) {
    if (i === refA || i === refB) continue
    const tree = trees[i]
    const base = positions[refB]
    const d0 = tree.distToFirst
    const d1 = tree.distToSecond
    const display = formatTreeDisplay(i + 1, tree.label)
    if (base === null || !(d0 > 0) || !(d1 > 0)) {
      errors.push(`${display}: distances must be greater than zero.`)
      continue
    }
    const b = base.x
    if (b + d0 <= d1 || b + d1 <= d0 || d0 + d1 <= b) {
      const baselineLabel = `${formatTreeDisplay(refA + 1, trees[refA].label)}-${formatTreeDisplay(refB + 1, trees[refB].label)}`
      errors.push(
        `${display}: ${d0.toFixed(1)} m and ${d1.toFixed(1)} m don't form a valid triangle with the ${baselineLabel} baseline (${b.toFixed(1)} m).`,
      )
      continue
    }
    const angleAt0 = Math.acos((b ** 2 + d0 ** 2 - d1 ** 2) / (2 * b * d0))
    const side = tree.flipSide ? -1 : 1
    positions[i] = { x: d0 * Math.cos(angleAt0), y: side * d0 * Math.sin(angleAt0) }
  }

  return { positions, errors }
}

/**
 * When the user picks a different pair of reference trees, every tree's
 * distToFirst/distToSecond/flipSide need to mean "relative to the NEW pair"
 * instead of the old one — even for trees whose own numbers don't change,
 * since those two fields are always interpreted relative to whichever trees
 * are currently the references. Rather than asking for new measurements,
 * this recomputes every tree's fields from the fully-known old geometry:
 * build positions under the OLD reference pair, find the rigid transform
 * that maps the NEW reference pair onto the origin/+x-axis, and re-derive
 * every tree's distances in that new frame. Returns an error instead of a
 * result if the old geometry doesn't have valid positions for both new
 * references — with neither position known, there's no frame to derive from.
 */
export function recomputeTreesForReferences(
  trees: TreeEntry[],
  oldRefA: number,
  oldRefB: number,
  newRefA: number,
  newRefB: number,
): { trees: TreeEntry[]; error: string | null } {
  if (newRefA === newRefB || !trees[newRefA] || !trees[newRefB]) {
    return { trees, error: 'Pick two different trees as references.' }
  }
  if (newRefA === oldRefA && newRefB === oldRefB) {
    return { trees, error: null }
  }

  const { positions: oldPositions } = buildTreePositions(trees, oldRefA, oldRefB)
  const newOrigin = oldPositions[newRefA]
  const newXAxis = oldPositions[newRefB]
  if (!newOrigin || !newXAxis) {
    return {
      trees,
      error:
        "Can't switch automatically yet — make sure both new reference trees have valid distances to the current references first.",
    }
  }

  const angle = Math.atan2(newXAxis.y - newOrigin.y, newXAxis.x - newOrigin.x)
  const cos = Math.cos(-angle)
  const sin = Math.sin(-angle)
  const toNewFrame = (p: Point): Point => {
    const dx = p.x - newOrigin.x
    const dy = p.y - newOrigin.y
    return { x: dx * cos - dy * sin, y: dx * sin + dy * cos }
  }
  // 2 decimals, not 1: rounding two related distances more coarsely can
  // collide exactly on the triangle-inequality boundary (e.g. 6.0 + 2.5 =
  // 8.5, invalidating an otherwise-fine reconstruction) even though the true
  // unrounded geometry — preserved exactly by the rigid transform above — was
  // never actually degenerate. 2 decimals keeps enough headroom to avoid that
  // in practice.
  const round = (n: number) => Math.round(n * 100) / 100
  const newRefBPos = toNewFrame(newXAxis)

  const updated = trees.map((tree, i) => {
    if (i === newRefA) {
      return { ...tree, distToFirst: 0, distToSecond: 0, flipSide: false }
    }
    const oldPos = oldPositions[i]
    if (!oldPos) return tree // couldn't place this one before either — nothing to derive it from
    const p = toNewFrame(oldPos)
    if (i === newRefB) {
      return { ...tree, distToFirst: round(Math.hypot(p.x, p.y)), distToSecond: 0, flipSide: false }
    }
    return {
      ...tree,
      distToFirst: round(Math.hypot(p.x, p.y)),
      distToSecond: round(distance(p, newRefBPos)),
      flipSide: p.y < 0,
    }
  })

  return { trees: updated, error: null }
}

function combinations3(n: number): Array<[number, number, number]> {
  const result: Array<[number, number, number]> = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        result.push([i, j, k])
      }
    }
  }
  return result
}

/**
 * Evaluates every 3-tree combination from the grove and ranks them by
 * "largest safety margin": pass beats tight beats fail, and within a tier,
 * the combo whose tightest individual check has the most headroom wins.
 */
export function rankCombinations(
  trees: TreeEntry[],
  settings: Settings,
  topN = 5,
  refA = 0,
  refB = 1,
): {
  combos: ComboResult[]
  positionErrors: string[]
  totalEvaluated: number
  positions: Array<Point | null>
} {
  const { positions, errors } = buildTreePositions(trees, refA, refB)
  const combos: ComboResult[] = []
  const { radius: tentRadius } = solveTentShape(settings)

  for (const [i, j, k] of combinations3(trees.length)) {
    const pi = positions[i]
    const pj = positions[j]
    const pk = positions[k]
    if (!pi || !pj || !pk) continue

    const labels: TreeLabels = {
      A: formatTreeDisplay(i + 1, trees[i].label),
      B: formatTreeDisplay(j + 1, trees[j].label),
      C: formatTreeDisplay(k + 1, trees[k].label),
    }
    const baseFit = computeFit(
      {
        dAB: distance(pi, pj),
        dBC: distance(pj, pk),
        dCA: distance(pk, pi),
        diameterA: trees[i].diameter,
        diameterB: trees[j].diameter,
        diameterC: trees[k].diameter,
      },
      settings,
      labels,
    )

    const otherTrees = projectOtherTrees(trees, positions, [i, j, k], baseFit.triangle)
    const obstructionCheck = checkGroveObstructions(
      [baseFit.cornerA, baseFit.cornerB, baseFit.cornerC],
      otherTrees,
      tentRadius,
    )
    const checks = [...baseFit.checks, obstructionCheck]
    const overallVerdict = checks.reduce<CheckResult['status']>(
      (worst, c) => (checkStatusRank(c.status) > checkStatusRank(worst) ? c.status : worst),
      'pass',
    )
    const fit: FitResult = { ...baseFit, checks, overallVerdict }

    const marginScore = checks.reduce((worst, c) => Math.min(worst, c.margin), Infinity)
    combos.push({ indices: [i, j, k], labels, fit, marginScore })
  }

  combos.sort((a, b) => {
    const rankDiff = checkStatusRank(a.fit.overallVerdict) - checkStatusRank(b.fit.overallVerdict)
    return rankDiff !== 0 ? rankDiff : b.marginScore - a.marginScore
  })

  return { combos: combos.slice(0, topN), positionErrors: errors, totalEvaluated: combos.length, positions }
}

function signedArea(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function rotate(p: Point, angle: number): Point {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }
}

/**
 * Maps every grove tree NOT in the selected combo into that combo's local
 * display frame (the one solveTriangle built: A at the origin, B on +x),
 * purely so the visualization can plot the whole grove for context. Built
 * from a 2-point similarity transform (translation + rotation + optional
 * mirror) between the combo's local A/B/C and their global positions —
 * exact up to floating point, since the two triangles share exact distances
 * by construction.
 */
export function projectOtherTrees(
  trees: TreeEntry[],
  positions: Array<Point | null>,
  selectedIndices: readonly [number, number, number],
  triangle: TriangleSolution,
): OtherTreePoint[] {
  if (!triangle.valid) return []
  const [i, j, k] = selectedIndices
  const globalA = positions[i]
  const globalB = positions[j]
  const globalC = positions[k]
  if (!globalA || !globalB || !globalC) return []

  const mirror = Math.sign(signedArea(triangle.A, triangle.B, triangle.C)) !== Math.sign(signedArea(globalA, globalB, globalC))
  const mirrorPoint = (p: Point): Point => (mirror ? { x: p.x, y: -p.y } : p)

  const localAngle = Math.atan2(triangle.B.y - triangle.A.y, triangle.B.x - triangle.A.x)
  const globalAngle = Math.atan2(globalB.y - globalA.y, globalB.x - globalA.x)
  const theta = globalAngle - localAngle

  const result: OtherTreePoint[] = []
  for (let idx = 0; idx < trees.length; idx++) {
    if (idx === i || idx === j || idx === k) continue
    const p = positions[idx]
    if (!p) continue
    const relative = { x: p.x - globalA.x, y: p.y - globalA.y }
    const local = mirrorPoint(rotate(relative, -theta))
    result.push({
      display: formatTreeDisplay(idx + 1, trees[idx].label),
      pos: { x: local.x + triangle.A.x, y: local.y + triangle.A.y },
      diameter: trees[idx].diameter,
    })
  }
  return result
}

function pointToSegmentDistance(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const lenSq = abx ** 2 + aby ** 2
  const t = lenSq > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq)) : 0
  const proj = { x: a.x + t * abx, y: a.y + t * aby }
  return distance(p, proj)
}

function isPointInTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const cross = (o: Point, u: Point, v: Point) => (u.x - o.x) * (v.y - o.y) - (u.y - o.y) * (v.x - o.x)
  const d1 = cross(p, a, b)
  const d2 = cross(p, b, c)
  const d3 = cross(p, c, a)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

/** Signed distance from p to the nearest edge of triangle abc — negative when p is inside. */
export function signedDistanceToTriangle(p: Point, a: Point, b: Point, c: Point): number {
  const edgeDist = Math.min(
    pointToSegmentDistance(p, a, b),
    pointToSegmentDistance(p, b, c),
    pointToSegmentDistance(p, c, a),
  )
  return isPointInTriangle(p, a, b, c) ? -edgeDist : edgeDist
}

/**
 * Checks whether any grove tree NOT in the selected combo physically sits
 * inside the tent's own footprint (accounting for that tree's trunk radius) —
 * a real dealbreaker even when the 3 chosen trees themselves check out fine.
 */
export function checkGroveObstructions(
  corners: [Point, Point, Point],
  otherTrees: OtherTreePoint[],
  radius: number,
): CheckResult {
  const label = 'Other trees clear of tent'
  if (otherTrees.length === 0) {
    return { id: 'groveObstruction', label, status: 'pass', detail: 'No other grove trees to check.', margin: 1 }
  }

  const [a, b, c] = corners
  let worstClearance = Infinity
  let worstDisplay = otherTrees[0].display
  for (const tree of otherTrees) {
    const trunkRadius = (tree.diameter ?? DEFAULT_TRUNK_DIAMETER) / 2
    const clearance = signedDistanceToTriangle(tree.pos, a, b, c) - trunkRadius
    if (clearance < worstClearance) {
      worstClearance = clearance
      worstDisplay = tree.display
    }
  }

  const margin = radius > 0 ? worstClearance / radius : -1
  if (worstClearance < 0) {
    return {
      id: 'groveObstruction',
      label,
      status: 'fail',
      detail: `Tree ${worstDisplay} sits inside the tent footprint (accounting for trunk width) — this pitch isn't physically usable.`,
      margin,
    }
  }
  return {
    id: 'groveObstruction',
    label,
    status: 'pass',
    detail: `Closest other tree (${worstDisplay}) has ${worstClearance.toFixed(2)} m clearance from the tent footprint.`,
    margin,
  }
}
