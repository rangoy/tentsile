import type {
  CheckResult,
  ComboResult,
  FitResult,
  FloatingAnchorResult,
  LevelAdjustment,
  LevelAdjustments,
  LevelAngles,
  OtherTreePoint,
  Point,
  Settings,
  TreeEntry,
  TreeInputs,
  TreeLabels,
  TriangleSolution,
  UnitSystem,
  VertexId,
} from './types'
import { formatDiameter, formatLength } from './units'

export const ANGLE_OK_MAX = 80
export const ANGLE_TIGHT_MAX = 100
export const DEFAULT_TRUNK_DIAMETER = 0.4
export const MIN_TRUNK_DIAMETER = 0.3
export const BEND_OK_MAX = 2
export const BEND_TIGHT_MAX = 7
export const MIN_TREES = 3
// rankCombinations checks every 3-tree combination (n choose 3), so cost grows
// roughly with the cube of tree count — 20 trees is ~1140 combinations, a
// couple of seconds worst case; well beyond that a single edit starts to
// visibly freeze the UI (see PERFORMANCE_WARNING_TREES for the earlier heads-up).
export const MAX_TREES = 20
export const PERFORMANCE_WARNING_TREES = 10
/** Golden-section search iterations for solveRedirectLoop — 60 halves the search bracket enough to converge to well under a micrometer. */
const LOOP_SEARCH_ITERATIONS = 60

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

function cornerPositions(center: Point, theta: number, phis: number[], radii: number[]): Point[] {
  return phis.map((phi, i) => ({
    x: center.x + radii[i] * Math.cos(theta + phi),
    y: center.y + radii[i] * Math.sin(theta + phi),
  }))
}

function evaluateCenter(center: Point, trees: Point[], phis: number[], radii: number[]) {
  const theta = optimalRotation(center, trees, phis)
  const corners = cornerPositions(center, theta, phis, radii)
  const bends = corners.map((corner, i) => angleBetweenVectors(center, corner, corner, trees[i]))
  const overshoot = trees.map((tree, i) => distance(center, tree) < radii[i])
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
function refineCenter(initial: CenterCandidate, trees: Point[], phis: number[], radii: number[]): CenterCandidate {
  let best = initial
  const avgRadius = radii.reduce((sum, r) => sum + r, 0) / radii.length
  let step = avgRadius * 0.5
  const MIN_STEP = avgRadius * 1e-5
  // Guards against near-duplicate/degenerate tree positions, where floating-point
  // noise in sumSquaredBend can otherwise look like an "improvement" every round
  // forever — without this, `step` never shrinks and the loop below never exits.
  const MIN_IMPROVEMENT = 1e-9
  const MAX_ITERATIONS = 200
  const directions = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ]
  let iterations = 0
  while (step > MIN_STEP && iterations < MAX_ITERATIONS) {
    iterations++
    let improved = false
    for (const dir of directions) {
      const candidate = evaluateCenter(
        { x: best.center.x + dir.x * step, y: best.center.y + dir.y * step },
        trees,
        phis,
        radii,
      )
      const introducesOvershoot = candidate.overshoot.some((o, i) => o && !best.overshoot[i])
      if (introducesOvershoot || candidate.sumSquaredBend >= best.sumSquaredBend - MIN_IMPROVEMENT) continue
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
 * one tree than that corner's own hub-to-corner radius — the corner would
 * then overshoot past that tree entirely, which is physically nonsensical
 * (the strap can't pass through the trunk). When that happens, this blends
 * the center back toward the triangle's centroid (a more conservative,
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
  radii: number[],
): { center: Point; theta: number; corners: Point[]; overshoot: boolean[] } {
  const fermat = fermatPoint(trees)
  const centroid = {
    x: (trees[0].x + trees[1].x + trees[2].x) / 3,
    y: (trees[0].y + trees[1].y + trees[2].y) / 3,
  }

  const STEPS = 24
  let fallback = evaluateCenter(centroid, trees, phis, radii)
  let accepted: CenterCandidate | null = null
  for (let step = 0; step <= STEPS; step++) {
    const t = 1 - step / STEPS
    const candidate = evaluateCenter(
      { x: centroid.x + t * (fermat.x - centroid.x), y: centroid.y + t * (fermat.y - centroid.y) },
      trees,
      phis,
      radii,
    )
    if (candidate.overshoot.every((o) => !o) && candidate.bends.every((b) => b <= BEND_TIGHT_MAX)) {
      accepted = candidate
      break
    }
    fallback = candidate // keep the closest-to-centroid attempt as a last resort
  }
  return refineCenter(accepted ?? fallback, trees, phis, radii)
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

/**
 * Shared with computeFloatingAnchor, which needs the exact same strap-length
 * rule for the redirected corner's own two segments (see there) as
 * computeFit already applies to a normal corner — same thresholds, same
 * wording, one source of truth.
 */
function strapCheck(id: string, label: string, reach: number, strap: number, settings: Settings): CheckResult {
  const unit = settings.unitSystem
  const marginVsMax = (settings.strapMax - strap) / settings.strapMax
  const marginVsRatchet = settings.ratchetLength > 0 ? strap / settings.ratchetLength : Infinity
  const margin = Math.min(marginVsMax, marginVsRatchet)
  if (strap > settings.strapMax) {
    return {
      id,
      label,
      status: 'fail',
      detail:
        settings.ratchetLength > 0
          ? `${formatLength(strap, unit)} of strap needed (after the ${formatLength(settings.ratchetLength, unit)} ratchet), longer than your ${formatLength(settings.strapMax, unit, 1)} strap.`
          : `${formatLength(reach, unit)} needed, longer than your ${formatLength(settings.strapMax, unit, 1)} strap.`,
      margin,
    }
  }
  if (settings.ratchetLength > 0 && strap < 0) {
    return {
      id,
      label,
      status: 'tight',
      detail: `Tree is closer than the ${formatLength(settings.ratchetLength, unit)} ratchet — use a basket loop (loop the strap directly around the tree, skipping the ratchet) instead.`,
      margin,
    }
  }
  return {
    id,
    label,
    status: 'pass',
    detail:
      settings.ratchetLength > 0
        ? `${formatLength(strap, unit)} of strap needed (${formatLength(reach, unit)} total reach).`
        : `${formatLength(reach, unit)} needed.`,
    margin,
  }
}

/** Shared with computeFloatingAnchor — see strapCheck. */
function bendCheck(id: string, label: string, center: Point, corner: Point, tree: Point): CheckResult {
  const angle = angleBetweenVectors(center, corner, corner, tree)
  const margin = 1 - angle / BEND_TIGHT_MAX
  if (angle > BEND_TIGHT_MAX) {
    return {
      id,
      label,
      status: 'fail',
      detail: `${angle.toFixed(1)}° off the tent's center line — beyond the ~7° of built-in strap tolerance.`,
      margin,
    }
  }
  if (angle > BEND_OK_MAX) {
    return {
      id,
      label,
      status: 'tight',
      detail: `${angle.toFixed(1)}° off the tent's center line — within the ~7° of built-in strap tolerance.`,
      margin,
    }
  }
  return { id, label, status: 'pass', detail: `${angle.toFixed(1)}° off the tent's center line.`, margin }
}

interface TentShape {
  valid: boolean
  reason?: string
  /** the tent's own 3 corners in its local frame, at 3 fixed "roles" (not tied to any tree yet); index 0 is the tip (opposite the base), 1 and 2 are the two base corners */
  corners: [Point, Point, Point]
  /** each corner's fixed hub-to-corner distance — generally *not* equal across corners for an isosceles tent (see solveTentShape) */
  radii: [number, number, number]
  /** each corner's fixed bearing from the hub */
  phis: [number, number, number]
}

/**
 * Solves the tent's own fixed floor shape: an isosceles triangle (two equal
 * "leg" sides, one possibly-shorter "base" side — an equilateral tent like
 * the Stingray is just the case where base equals the legs too), and the
 * fixed "hub" point the tent's own underfloor straps converge on (the point
 * `placeTent` aims to point straight at all three trees for zero bend).
 *
 * An earlier version of this function placed the hub at the tent triangle's
 * *circumcenter* (equidistant from all 3 corners) — a convenient
 * generalization of the Stingray's 120°-apart corners, but not one grounded
 * in how a real isosceles Tentsile platform (e.g. the Connect) is actually
 * built. Cross-checking against the independently-developed app "Tentsile
 * Triangulator" (https://github.com/munifrog/tentsile) found it uses a
 * different, non-equidistant hub for every real isosceles product it models
 * (Connect, Duo, Flite, T-Mini, Una — see
 * `android/app/src/full/java/.../ComposeActivity.java`): the hub angle comes
 * from `Util.getSmallAngleGivenIndent(leg, base, indent=0)` in
 * `android/app/src/main/java/.../Util.java`, i.e.
 * `tetherAngle = 90° + asin(base / (2 * leg))` — not from equal corner
 * distances. Simulating both hub models against the same tree triangles
 * showed they can disagree by *meters* of computed strap length for a
 * genuinely isosceles tent (and even disagree on which tree should take the
 * tip corner), so this now follows Tentsile Triangulator's formula instead.
 *
 * Neither model is a verified physical measurement, though — Tentsile
 * Triangulator's own FAQ (`faq_sight_indicator_answer` in
 * `android/app/src/main/res/values/strings.xml`) says as much: for
 * "non-equal-sided tents and hammocks" it only "tries to get you close" to
 * the right spot, with final alignment meant to come from the physical
 * sight-indicator tabs sewn onto the real product's sides. This app has no
 * such tabs to render, so an isosceles tent's numbers should be read the
 * same way: a close starting point, not an exact one — and unlike the
 * Stingray (cross-checked against a real worked example, see computeFit),
 * this app's author has not personally tested a non-equal-sided tent against
 * these numbers (see the UI warning shown whenever leg ≠ base).
 *
 * Degenerates cleanly to the old equilateral case when leg === base: gamma =
 * asin(0.5) = 30°, so tetherAngle = 120° and, by symmetry, all 3 radii come
 * out equal — nothing changes for the Stingray.
 */
function solveTentShape(settings: Settings): TentShape {
  const { tentLegLength: leg, tentBaseLength: base } = settings
  const shape = solveTriangle({ dAB: leg, dBC: leg, dCA: base, diameterA: null, diameterB: null, diameterC: null })
  if (!shape.valid) {
    return { valid: false, reason: shape.reason, corners: [shape.A, shape.B, shape.C], radii: [0, 0, 0], phis: [0, 0, 0] }
  }

  const gamma = Math.asin(base / (2 * leg))
  const tetherAngle = Math.PI / 2 + gamma
  const largeAngle = (2 * Math.PI - tetherAngle) / 2
  const centerHeight = Math.sqrt(leg ** 2 - (base / 2) ** 2)
  const baseHalf = base / 2
  const baseTether = baseHalf / Math.sin(largeAngle) // hub-to-corner distance for each of the 2 base corners
  const baseCenterOffset = Math.sqrt(baseTether ** 2 - baseHalf ** 2)
  const tipTether = centerHeight - baseCenterOffset // hub-to-corner distance for the tip

  const corners: [Point, Point, Point] = [
    { x: tipTether, y: 0 },
    { x: -baseCenterOffset, y: baseHalf },
    { x: -baseCenterOffset, y: -baseHalf },
  ]
  const radii: [number, number, number] = [tipTether, baseTether, baseTether]
  const phis: [number, number, number] = [
    0,
    Math.atan2(baseHalf, -baseCenterOffset),
    Math.atan2(-baseHalf, -baseCenterOffset),
  ]
  return { valid: true, corners, radii, phis }
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
      reachA: 0,
      reachB: 0,
      reachC: 0,
      strapA: 0,
      strapB: 0,
      strapC: 0,
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
      reachA: 0,
      reachB: 0,
      reachC: 0,
      strapA: 0,
      strapB: 0,
      strapC: 0,
      checks,
      overallVerdict: 'fail',
    }
  }
  const { corners: tentCorners, radii: baseRadii, phis: basePhis } = tentShape

  // Which tree plays which of the tent's 3 fixed corner roles matters once
  // the tent isn't equilateral (see PERMUTATIONS_3) — try all 6 and keep
  // whichever assignment overshoots the fewest trees, then bends the least
  // (Fermat point when it fits without overshooting any tree; otherwise
  // blended back toward the centroid just far enough to clear every tree,
  // within the same 7° bend tolerance the per-corner bend check allows —
  // see placeTent).
  let best: { center: Point; theta: number; corners: Point[]; overshoot: boolean[]; perm: readonly [number, number, number]; radii: number[]; overshootCount: number; maxBend: number } | null = null
  for (const perm of PERMUTATIONS_3) {
    const phis = perm.map((role) => basePhis[role])
    const radii = perm.map((role) => baseRadii[role])
    const candidate = placeTent(trees, phis, radii)
    const bends = candidate.corners.map((corner, i) => angleBetweenVectors(candidate.center, corner, corner, trees[i]))
    const overshootCount = candidate.overshoot.filter(Boolean).length
    const maxBend = Math.max(...bends)
    if (!best || overshootCount < best.overshootCount || (overshootCount === best.overshootCount && maxBend < best.maxBend)) {
      best = { ...candidate, perm, radii, overshootCount, maxBend }
    }
  }
  const { center, theta, corners, overshoot, perm, radii: cornerRadii } = best!
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

  // Reach is the raw geometric distance from the (Fermat-point-positioned)
  // tent corner to the tree — verified against a reference implementation
  // (Tentsile Triangulator) that reports exactly this raw reach. Neither the
  // fixed ratchet length nor trunk circumference is subtracted from it; trunk
  // thickness still factors into the max-distance check below, and the
  // ratchet is handled separately (folded into the "Strap to X" check) since
  // it's a fixed segment between the tent corner and the strap, not part of
  // the strap's own adjustable length.
  const reachA = distance(cornerA, A)
  const reachB = distance(cornerB, B)
  const reachC = distance(cornerC, C)

  // Portion of the reach left for the adjustable strap once the fixed
  // ratchet is accounted for. Negative means the tree is closer than the
  // ratchet itself reaches — a basket loop (skip the ratchet, loop the strap
  // directly around the trunk) is needed instead of the standard setup.
  const strapA = reachA - settings.ratchetLength
  const strapB = reachB - settings.ratchetLength
  const strapC = reachC - settings.ratchetLength

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
    // Reach without leaning on the ratchet's extra length, vs. the true max
    // once both corners' fixed ratchets are counted too (each ratchet adds
    // its own length to that corner's reach, since it's in series with the strap).
    const maxDistNoRatchet = 2 * settings.strapMax + edge.tentSide - edge.circumSum
    const maxDist = maxDistNoRatchet + 2 * settings.ratchetLength
    // No hard minimum here: trees closer together are workable with a basket
    // loop (skip the ratchet, loop the strap directly around the trunk), which
    // is exactly what the per-corner "Strap to X" check below already flags —
    // so margin only tracks headroom below the max reach, not a lower bound.
    const margin = maxDist > 0 ? (maxDist - edge.dist) / maxDist : -1
    if (edge.dist > maxDist) {
      checks.push({
        id: edge.id,
        label: edge.label,
        status: 'fail',
        detail: `${formatLength(edge.dist, settings.unitSystem)} exceeds the ${formatLength(maxDist, settings.unitSystem)} max reach with a ${formatLength(settings.strapMax, settings.unitSystem, 1)} strap and ${formatLength(settings.ratchetLength, settings.unitSystem)} ratchet.`,
        margin,
      })
    } else if (edge.dist > maxDistNoRatchet) {
      checks.push({
        id: edge.id,
        label: edge.label,
        status: 'tight',
        detail: `${formatLength(edge.dist, settings.unitSystem)} relies on the ratchet's reach (max without it: ${formatLength(maxDistNoRatchet, settings.unitSystem)}, with it: ${formatLength(maxDist, settings.unitSystem)}).`,
        margin,
      })
    } else {
      checks.push({
        id: edge.id,
        label: edge.label,
        status: 'pass',
        detail: `${formatLength(edge.dist, settings.unitSystem)} (max reach ${formatLength(maxDistNoRatchet, settings.unitSystem)}).`,
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
        detail: `${formatDiameter(trunk.value * 100, settings.unitSystem)} is below the recommended ${formatDiameter(MIN_TRUNK_DIAMETER * 100, settings.unitSystem)} minimum.`,
        margin,
      })
    } else {
      checks.push({
        id: trunk.id,
        label: trunk.label,
        status: 'pass',
        detail: `${formatDiameter(trunk.value * 100, settings.unitSystem)} diameter.`,
        margin,
      })
    }
  }

  // --- Strap length checks (reach = fixed ratchet + adjustable strap, in series) ---
  // strapMax is the strap's own max length — the fixed ratchet doesn't count
  // against it, since it's separate hardware closest to the tent corner. If
  // the tree is closer than the ratchet itself already reaches, skip the
  // ratchet and loop the strap straight around the trunk instead (a "basket
  // loop"). Reports the worse of the two bounds (too-long vs. basket-loop)
  // as a single check per corner, rather than two separate entries for what
  // is really one strap.
  const straps: Array<{ id: string; label: string; reach: number; strap: number }> = [
    { id: 'strapA', label: `Strap to ${labels.A}`, reach: reachA, strap: strapA },
    { id: 'strapB', label: `Strap to ${labels.B}`, reach: reachB, strap: strapB },
    { id: 'strapC', label: `Strap to ${labels.C}`, reach: reachC, strap: strapC },
  ]
  for (const strap of straps) {
    checks.push(strapCheck(strap.id, strap.label, strap.reach, strap.strap, settings))
  }

  // --- Bend checks (deviation of each strap from its center-to-corner spoke) ---
  const bends: Array<{ id: string; label: string; corner: Point; tree: Point }> = [
    { id: 'bendA', label: `Strap bend at ${labels.A}`, corner: cornerA, tree: A },
    { id: 'bendB', label: `Strap bend at ${labels.B}`, corner: cornerB, tree: B },
    { id: 'bendC', label: `Strap bend at ${labels.C}`, corner: cornerC, tree: C },
  ]
  for (const bend of bends) {
    checks.push(bendCheck(bend.id, bend.label, center, bend.corner, bend.tree))
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
  for (const [i, fit] of fits.entries()) {
    const clearance = distance(center, fit.tree) - cornerRadii[i]
    const margin = clearance / cornerRadii[i]
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
        detail: `${formatLength(clearance, settings.unitSystem)} of clearance before this corner would reach the tree.`,
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
    reachA,
    reachB,
    reachC,
    strapA,
    strapB,
    strapC,
    checks,
    overallVerdict,
  }
}

/**
 * The redirect loop's equilibrium position on the circle of radius `pullReach`
 * around the 4th tree `treeD`, for a strap running corner -> loop -> tree,
 * frictionless where the pull strap loops around it (equal tension both
 * sides). Physics:
 * a frictionless loop can't sustain any net tangential force, so the loop
 * settles wherever the *total* corner-to-loop-to-tree length is shortest
 * subject to staying on that circle — equivalently, the classic force-balance
 * condition that the pull strap (loop -> treeD) exactly bisects the bend
 * angle at the loop. Verified these two formulations agree numerically
 * (brute-force circle scan vs. this solver, both converging on the same
 * point to within float precision) before porting this in — see the physics
 * derivation the user asked for ("step back to get the physics right ...
 * can we use a physics simulator").
 *
 * Two regimes: the loop sits right on the still-straight corner-tree segment
 * whenever the circle reaches it at all (see onSegmentLoopPosition, a closed
 * form — no search, and the only way to land tightness = 0 exactly on the
 * real tree rather than on some other energy-tied point along the strap);
 * otherwise a genuine bend, solved by golden-section search on the circle's
 * angle (unimodal there: folded length is a smooth, single-troughed function
 * of angle near the geometric guess), bracketed by a +-90 degree window
 * around the point-on-circle closest to the corner-tree line — always
 * contains the true minimum since the optimum can't lie further than a
 * quarter turn from that geometric guess.
 */
function foldedStrapLength(corner: Point, tree: Point, treeD: Point, pullReach: number, angle: number): number {
  const loop = { x: treeD.x + pullReach * Math.cos(angle), y: treeD.y + pullReach * Math.sin(angle) }
  return distance(corner, loop) + distance(loop, tree)
}

/**
 * When the target circle (radius `pullReach` around `treeD`) crosses the
 * still-straight corner-tree segment, sitting right on that segment always
 * beats any off-segment/bent alternative — folding through any other point
 * on the circle can only be longer, by the triangle inequality — so that's
 * the loop's true equilibrium there, no search needed. A circle can cross a
 * line at up to two points; energy alone can't distinguish between two
 * on-segment crossings (both give the same, minimal, unbent total length —
 * a real degenerate tie, not just a numerical one), so this deliberately
 * picks whichever crossing is nearer the real tree. That's what keeps this
 * continuous with `pullReach` = the tree's own distance from `treeD`
 * (`tightness = 0`) landing exactly on the tree — the other, nearer-corner
 * crossing is an equally valid *energy* minimum but isn't the physically
 * meaningful branch connected to "nothing has happened yet." Returns null
 * when no on-segment crossing exists (the circle is too small to reach the
 * segment at all), for solveRedirectLoop to fall back to a genuine bend.
 */
function onSegmentLoopPosition(corner: Point, tree: Point, treeD: Point, pullReach: number): Point | null {
  const dx = tree.x - corner.x
  const dy = tree.y - corner.y
  const dd = dx * dx + dy * dy
  if (dd <= 1e-12) return null

  const fx = corner.x - treeD.x
  const fy = corner.y - treeD.y
  const fDotD = fx * dx + fy * dy
  const ff = fx * fx + fy * fy
  const discriminant = fDotD * fDotD - dd * (ff - pullReach * pullReach)
  if (discriminant < 0) return null

  const tClosest = -fDotD / dd
  const root = Math.sqrt(discriminant) / dd
  const tPlus = tClosest + root
  const tMinus = tClosest - root
  const tTree = Math.abs(tPlus - 1) <= Math.abs(tMinus - 1) ? tPlus : tMinus
  if (tTree < -1e-9 || tTree > 1 + 1e-9) return null

  const t = Math.min(1, Math.max(0, tTree))
  return { x: corner.x + t * dx, y: corner.y + t * dy }
}

function solveRedirectLoop(corner: Point, tree: Point, treeD: Point, pullReach: number): Point {
  if (pullReach <= 1e-9) return { ...treeD }

  const onSegment = onSegmentLoopPosition(corner, tree, treeD, pullReach)
  if (onSegment) return onSegment

  const dx = tree.x - corner.x
  const dy = tree.y - corner.y
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((treeD.x - corner.x) * dx + (treeD.y - corner.y) * dy) / lengthSquared)) : 0
  const closest = { x: corner.x + t * dx, y: corner.y + t * dy }
  const guessAngle = Math.atan2(closest.y - treeD.y, closest.x - treeD.x)

  let lo = guessAngle - Math.PI / 2
  let hi = guessAngle + Math.PI / 2
  const gr = (Math.sqrt(5) - 1) / 2
  let c = hi - gr * (hi - lo)
  let d = lo + gr * (hi - lo)
  let fc = foldedStrapLength(corner, tree, treeD, pullReach, c)
  let fd = foldedStrapLength(corner, tree, treeD, pullReach, d)
  for (let i = 0; i < LOOP_SEARCH_ITERATIONS; i++) {
    if (fc < fd) {
      hi = d
      d = c
      fd = fc
      c = hi - gr * (hi - lo)
      fc = foldedStrapLength(corner, tree, treeD, pullReach, c)
    } else {
      lo = c
      c = d
      fc = fd
      d = lo + gr * (hi - lo)
      fd = foldedStrapLength(corner, tree, treeD, pullReach, d)
    }
  }
  const angle = (lo + hi) / 2
  return { x: treeD.x + pullReach * Math.cos(angle), y: treeD.y + pullReach * Math.sin(angle) }
}

/**
 * How much pull strap `computeFloatingAnchor` deploys at `tightness = 0`,
 * its loosest setting: the straight-line distance from the corner's own real
 * tree to the 4th tree. Deploying exactly that much puts the real tree
 * itself on the target circle (trivially, `dist(tree, treeD) = ` that same
 * length) — and by the triangle inequality, folding the main strap through
 * any *other* point on that circle can only be longer than going straight
 * through the tree, never shorter, so the tree itself is always the loop's
 * unique energy-minimizing equilibrium there (see solveRedirectLoop). `fit`
 * therefore reproduces `baseFit` byte-for-byte at tightness = 0 as a
 * consequence of the physics, with no special-casing needed to force it —
 * genuinely "loosely attach, nothing has happened yet."
 *
 * (For pull lengths between this and the point where the loop would first
 * leave the corner-tree line entirely, the same triangle-inequality argument
 * still picks an on-segment loop position — the physics naturally has a
 * "slack, does nothing yet" regime before real bending starts, matching how
 * paying out a very long pull strap in the field doesn't visibly do
 * anything until you take up enough of the slack.)
 *
 * Capped by what the pull strap's own hardware can physically reach
 * (`settings.strapMax + settings.ratchetLength`) — when the hardware falls
 * short of the real tree's own distance, tightness = 0 may still show some
 * bend, since the deployed length can't even reach that far.
 */
export function maxRedirectSlackReach(
  baseFit: FitResult,
  cornerId: VertexId,
  redirectTreePos: Point,
  settings: Settings,
): number {
  const realTreePos = baseFit.triangle[cornerId]
  return Math.min(distance(realTreePos, redirectTreePos), settings.strapMax + settings.ratchetLength)
}

/**
 * A 4th-tree "floating anchor" redirect (see FloatingAnchorResult in types.ts,
 * and the FAQ answer this is modeled on:
 * `faq_fourth_tree_method_answer` in Tentsile Triangulator
 * (https://github.com/munifrog/tentsile),
 * `android/app/src/main/res/values/strings.xml`), matching its own
 * step-by-step procedure closely: "(4) loosely attach the third strap to the
 * third tree" — the corner's own strap runs its full, real length, not cut
 * short — "(5) loop the fourth ratchet around the third strap" — "(6) attach
 * the fourth strap to the fourth tree" — "(7) tighten the third and fourth
 * straps together."
 *
 * Unlike the app's own earlier two-parameter version of this (a `fraction`
 * choosing *where* the ratchet grabs, plus a `pullLength` choosing how far
 * that point got pulled), this is governed by a single physically-derived
 * `tightness` (0-1): the loop is frictionless, and where a frictionless loop
 * settles isn't a modeling choice, it's a consequence of equal tension on
 * both sides — see solveRedirectLoop. `tightness = 0`
 * deploys the most pull strap that can ever matter (`maxRedirectSlackReach`)
 * and, right at that length, the loop's equilibrium sits exactly at the
 * corner's own real tree — `fit` byte-for-byte matching `baseFit`. That's
 * not a special case bolted on, the physics does it on its own (see
 * maxRedirectSlackReach); "loosely attach, nothing has happened yet" falls
 * out of the model instead of needing separate code to guarantee it.
 * `tightness = 1` deploys none: the loop sits right at the 4th tree, the
 * tightest the redirect can ever pull. (Earlier iterations tried to pick the
 * grab point and how far it moved as two independent, ad-hoc geometric
 * choices — variously overshooting the 4th tree, dragging the tent's whole
 * rotation toward it, or leaving the grab point frozen and un-pulled — each
 * caught from a screenshot; the fix wasn't a better heuristic; it was
 * dropping the heuristics for the actual physics of a loop under tension.)
 *
 * The tent's own placement genuinely moves in response, by re-solving the
 * whole thing via `computeFit` with the loop standing in for `cornerId`'s
 * own tree — a real tensioned structure finds a new equilibrium once one
 * corner's effective pull direction changes, the same way the other two
 * corners already get whatever placement best points them at their own real
 * trees.
 *
 * `computeFit`'s own `solveTriangle` call anchors its solved "A" at its own
 * origin and "B" along its own +x axis, unrelated to `baseFit`'s frame, so
 * its raw output is mapped back via `buildFrameMapper` before it means
 * anything positioned next to a real tree or the loop — same correction
 * `projectOtherTrees` already needs for the same reason.
 *
 * The strap-length check for `cornerId` covers the *bent total* path
 * (`cornerToGrabReach + grabToTreeReach`, using the corner's newly re-solved
 * position), always at least as long as the straight-line reach `computeFit`
 * itself reports for that corner; trunk-diameter is dropped (a loop has no
 * trunk); a new check covers the pull strap's own length (which, by
 * construction, never exceeds `settings.strapMax + settings.ratchetLength` —
 * see maxRedirectSlackReach — so it can only ever read "tight," i.e. too
 * close for the ratchet's own basket loop, never "too far"). Every other
 * check — including the *other* two corners' bend and reach, which can
 * legitimately shift now that the tent's placement does — comes straight
 * from the re-solved fit.
 */
export function computeFloatingAnchor(
  baseFit: FitResult,
  cornerId: VertexId,
  redirectTreePos: Point,
  tightness: number,
  diameters: { diameterA: number | null; diameterB: number | null; diameterC: number | null },
  settings: Settings,
  labels: TreeLabels = DEFAULT_LABELS,
): FloatingAnchorResult {
  const realTreePos = baseFit.triangle[cornerId]
  const baseCorner = baseFit[`corner${cornerId}` as 'cornerA' | 'cornerB' | 'cornerC']

  const slackReach = maxRedirectSlackReach(baseFit, cornerId, redirectTreePos, settings)
  const clampedTightness = Math.min(1, Math.max(0, tightness))
  const pullReach = slackReach * (1 - clampedTightness)
  const virtualPoint = solveRedirectLoop(baseCorner, realTreePos, redirectTreePos, pullReach)

  const A = cornerId === 'A' ? virtualPoint : baseFit.triangle.A
  const B = cornerId === 'B' ? virtualPoint : baseFit.triangle.B
  const C = cornerId === 'C' ? virtualPoint : baseFit.triangle.C

  const cornerDiameters = { diameterA: diameters.diameterA, diameterB: diameters.diameterB, diameterC: diameters.diameterC }
  cornerDiameters[`diameter${cornerId}` as 'diameterA' | 'diameterB' | 'diameterC'] = null

  const rawFit = computeFit(
    { dAB: distance(A, B), dBC: distance(B, C), dCA: distance(C, A), ...cornerDiameters },
    settings,
    labels,
  )

  const resolvedFit: FitResult = rawFit.triangle.valid
    ? (() => {
        const mapToFrame = buildFrameMapper(rawFit.triangle.A, rawFit.triangle.B, rawFit.triangle.C, A, B, C)
        return {
          ...rawFit,
          center: mapToFrame(rawFit.center),
          cornerA: mapToFrame(rawFit.cornerA),
          cornerB: mapToFrame(rawFit.cornerB),
          cornerC: mapToFrame(rawFit.cornerC),
          triangle: { ...rawFit.triangle, A, B, C },
        }
      })()
    : rawFit

  const corner = resolvedFit[`corner${cornerId}` as 'cornerA' | 'cornerB' | 'cornerC']
  const cornerToGrabReach = distance(corner, virtualPoint)
  const grabToTreeReach = distance(virtualPoint, realTreePos)
  const totalReach = cornerToGrabReach + grabToTreeReach
  const totalStrap = totalReach - settings.ratchetLength

  const redirectReach = distance(virtualPoint, redirectTreePos)
  const redirectStrap = redirectReach - settings.ratchetLength

  // The angle, at the grab point, between the pull strap (grab point -> the
  // real 4th tree) and the redirected strap's own first segment (corner ->
  // grab point) — purely informational, derived from the loop's
  // force-balance equilibrium (see solveRedirectLoop) rather than an
  // independent design choice: whatever it reads is whatever a real
  // frictionless loop under tension would settle at for this geometry and
  // tightness, not a target to aim for.
  const redirectAngleDeg = angleBetweenVectors(corner, virtualPoint, virtualPoint, redirectTreePos)

  const checks: CheckResult[] = resolvedFit.checks
    .filter((c) => c.id !== `trunk${cornerId}`)
    .map((c) => (c.id === `strap${cornerId}` ? strapCheck(c.id, c.label, totalReach, totalStrap, settings) : c))
  checks.push(strapCheck('redirectStrap', 'Redirect strap (grab point → 4th tree)', redirectReach, redirectStrap, settings))

  const overallVerdict = checks.reduce<CheckResult['status']>(
    (worst, c) => (checkStatusRank(c.status) > checkStatusRank(worst) ? c.status : worst),
    'pass',
  )

  const fit: FitResult = {
    ...resolvedFit,
    [`reach${cornerId}`]: totalReach,
    [`strap${cornerId}`]: totalStrap,
    checks,
    overallVerdict,
  }

  return { cornerId, virtualPoint, fit, cornerToGrabReach, grabToTreeReach, redirectReach, redirectStrap, redirectAngleDeg }
}

/**
 * Finds the *least* tightness (0-1) that gives this redirect a clean "Good
 * fit" (`overallVerdict === 'pass'`), rather than making the user hunt for it
 * by hand or cranking it needlessly tight. Deliberately targets a clean pass
 * — every check comfortably clear of its own threshold — not merely "no
 * check technically failing" (`margin >= 0`, the fail boundary): that
 * looser bar is fragile, since it lets the search settle for a razor-thin
 * margin on some check that has nothing to do with the redirected corner,
 * far from where the corner's own actual issue gets resolved. Caught
 * directly from a screenshot and the report "the proposed solution moves the
 * tent almost to the added tree": a first version targeting `margin >= 0`
 * returned 77% tightness — overshooting into a near-fully-cranked, visibly
 * distorted placement — when 6% already gave a clean "Good fit" and the
 * corner's own bend even passed clean through a 90° pull around 14%; told
 * directly, "the autofit should try to solve for the least pull that gives
 * an OK result," meaning a result actually worth calling OK, not a technical
 * non-failure. Not just the redirected corner's own checks: re-solving the
 * tent shifts the *other* two corners too (see computeFloatingAnchor), and a
 * tightness that fixes one corner while leaving another merely "tight" or
 * worse isn't a clean pass overall either.
 *
 * Least tightness, not best: a real pull strap under more tension than it
 * needs to be is just unnecessary load on the hardware and the trees, so
 * this deliberately stops at the first tightness (scanning up from 0) that
 * clears the bar rather than continuing to search for whatever tightness
 * clears it by the *most* — even if some larger tightness would score
 * better, it's not what a person tightening this in the field would want by
 * default. If tightness = 0 already clears it, no pull is needed at all —
 * matching `computeFloatingAnchor`'s own tightness = 0 exactly reproducing
 * the un-redirected fit.
 *
 * The pass/fail boundary isn't guaranteed to cross only once as tightness
 * rises — so this scans a coarse grid first (cheap: computeFit is a single
 * closed-form triangle solve, not a combinatorial search) and only bisects
 * the interval where it *first* crosses into "Good fit" for a precise
 * answer, rather than assuming that's the only crossing. If it never crosses
 * at all in [0, 1] — this redirect can't get a clean pass no matter how
 * tight — falls back to whichever tightness scores best by worst-margin,
 * refined with golden-section search (safe there: unlike finding the
 * *first* crossing, maximizing a single hump around the best coarse sample
 * doesn't depend on there being only one).
 */
export function solveFloatingAnchorTightness(
  baseFit: FitResult,
  cornerId: VertexId,
  redirectTreePos: Point,
  diameters: { diameterA: number | null; diameterB: number | null; diameterC: number | null },
  settings: Settings,
  labels: TreeLabels = DEFAULT_LABELS,
): number {
  const evaluate = (tightness: number): { worstMargin: number; isGoodFit: boolean } => {
    const result = computeFloatingAnchor(baseFit, cornerId, redirectTreePos, tightness, diameters, settings, labels)
    return {
      worstMargin: result.fit.checks.reduce((worst, c) => Math.min(worst, c.margin), Infinity),
      isGoodFit: result.fit.overallVerdict === 'pass',
    }
  }

  const GRID_SAMPLES = 100

  let bestT = 0
  const zero = evaluate(0)
  let bestScore = zero.worstMargin
  if (zero.isGoodFit) return 0

  for (let i = 1; i <= GRID_SAMPLES; i++) {
    const t = i / GRID_SAMPLES
    const { worstMargin, isGoodFit } = evaluate(t)
    if (worstMargin > bestScore) {
      bestScore = worstMargin
      bestT = t
    }
    if (isGoodFit) {
      // Crossed from "not a good fit" to "good fit" between the previous
      // sample and this one — bisect for the precise least tightness that
      // clears it, rather than settling for the grid's own 1%-wide
      // resolution. A clean "pass" verdict (every check comfortably clear of
      // its own threshold), not merely no check technically failing — a
      // razor-thin margin=0 crossing is fragile and can land somewhere far
      // from where the redirected corner's own issue is actually resolved
      // (caught directly: "the proposed solution moves the tent almost to
      // the added tree" at a 77% result, when 6% already gave a clean "Good
      // fit").
      let lo = (i - 1) / GRID_SAMPLES
      let hi = t
      for (let j = 0; j < 40; j++) {
        const mid = (lo + hi) / 2
        if (evaluate(mid).isGoodFit) hi = mid
        else lo = mid
      }
      return hi
    }
  }

  // Never reaches a clean "Good fit" anywhere in [0, 1] — fall back to
  // whichever tightness comes closest (maximizing the same worst-margin
  // score), refined locally with golden-section search.
  let lo = Math.max(0, bestT - 1 / GRID_SAMPLES)
  let hi = Math.min(1, bestT + 1 / GRID_SAMPLES)
  const gr = (Math.sqrt(5) - 1) / 2
  let c = hi - gr * (hi - lo)
  let d = lo + gr * (hi - lo)
  let fc = evaluate(c).worstMargin
  let fd = evaluate(d).worstMargin
  for (let i = 0; i < 30; i++) {
    if (fc > fd) {
      hi = d
      d = c
      fd = fc
      c = hi - gr * (hi - lo)
      fc = evaluate(c).worstMargin
    } else {
      lo = c
      c = d
      fc = fd
      d = lo + gr * (hi - lo)
      fd = evaluate(d).worstMargin
    }
  }
  const refinedT = (lo + hi) / 2
  return evaluate(refinedT).worstMargin > bestScore ? refinedT : bestT
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
  unit: UnitSystem = 'metric',
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
        `${display}: ${formatLength(d0, unit, 1)} and ${formatLength(d1, unit, 1)} don't form a valid triangle with the ${baselineLabel} baseline (${formatLength(b, unit, 1)}).`,
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
  const { positions, errors } = buildTreePositions(trees, refA, refB, settings.unitSystem)
  const combos: ComboResult[] = []
  // Only used to scale the grove-obstruction margin below, so an average across
  // the (possibly unequal, for an isosceles tent) 3 corner radii is fine here.
  const { radii: tentRadii } = solveTentShape(settings)
  const tentRadius = tentRadii.reduce((sum, r) => sum + r, 0) / tentRadii.length

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
      settings.unitSystem,
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
 * Builds a function mapping points from one frame into another, given the
 * known correspondence of 3 (non-collinear) points between them — a 2-point
 * similarity transform (translation + rotation + mirror when the two
 * triangles' chirality differs), exact up to floating point since both
 * triangles share exact pairwise distances by construction. Used both to
 * project the rest of a grove into a combo's local display frame
 * (projectOtherTrees) and to map a freshly re-solved sub-fit's own local
 * frame back into the frame its input distances were measured in
 * (computeFloatingAnchor) — solveTriangle always anchors its solved point
 * "A" at its own origin and "B" along its own +x axis, with no relation to
 * any other frame's absolute orientation or chirality, so re-solving a
 * triangle and then just reusing its raw output only works by coincidence.
 */
function buildFrameMapper(
  sourceA: Point,
  sourceB: Point,
  sourceC: Point,
  targetA: Point,
  targetB: Point,
  targetC: Point,
): (p: Point) => Point {
  const mirror = Math.sign(signedArea(sourceA, sourceB, sourceC)) !== Math.sign(signedArea(targetA, targetB, targetC))
  const mirrorPoint = (p: Point): Point => (mirror ? { x: p.x, y: -p.y } : p)

  const sourceAngle = Math.atan2(sourceB.y - sourceA.y, sourceB.x - sourceA.x)
  const targetAngle = Math.atan2(targetB.y - targetA.y, targetB.x - targetA.x)
  // rotate() runs BEFORE mirrorPoint() below, and mirroring (negating y) negates
  // whatever angle rotation just produced — so reaching targetAngle after a
  // mirror means rotating to *its negation* first, not to targetAngle itself.
  // Only when the target's own B happens to sit at angle 0 (solveTriangle's own
  // canonical frame, always true for the projectOtherTrees call site) does this
  // collapse to the same value either way, which is why testing only that call
  // site never caught this.
  const theta = mirror ? -targetAngle - sourceAngle : targetAngle - sourceAngle

  return (p: Point): Point => {
    const relative = { x: p.x - sourceA.x, y: p.y - sourceA.y }
    const local = mirrorPoint(rotate(relative, theta))
    return { x: local.x + targetA.x, y: local.y + targetA.y }
  }
}

/**
 * Re-expresses `fit`'s corner/center/triangle points in a different frame,
 * given where its own local A/B/C should land there. solveTriangle always
 * anchors its solved "A" at its own origin and "B" along its own +x axis,
 * unrelated to any other frame's orientation — every combo's fit is
 * independently solved that way, so switching combos otherwise reorients
 * the whole diagram arbitrarily. Mapping every combo's fit into one shared
 * frame (the grove's own global positions from buildTreePositions) instead
 * keeps the displayed layout visually stable across combo switches, so
 * different combos can actually be compared by eye.
 *
 * A no-op for any purely relative computation done on the result afterward
 * — computeFloatingAnchor in particular only ever uses distances plus its
 * own frame's A/B/C, so it works identically fed either the original local
 * fit or this remapped one, as long as everything passed alongside it (e.g.
 * a redirect tree's position) is expressed in that same frame.
 */
export function mapFitToFrame(fit: FitResult, targetA: Point, targetB: Point, targetC: Point): FitResult {
  if (!fit.triangle.valid) return fit
  const { A, B, C } = fit.triangle
  const mapToFrame = buildFrameMapper(A, B, C, targetA, targetB, targetC)
  return {
    ...fit,
    center: mapToFrame(fit.center),
    cornerA: mapToFrame(fit.cornerA),
    cornerB: mapToFrame(fit.cornerB),
    cornerC: mapToFrame(fit.cornerC),
    triangle: { ...fit.triangle, A: targetA, B: targetB, C: targetC },
  }
}

/**
 * Maps every grove tree NOT in the selected combo into that combo's local
 * display frame (the one solveTriangle built: A at the origin, B on +x),
 * purely so the visualization can plot the whole grove for context.
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

  const mapToLocal = buildFrameMapper(globalA, globalB, globalC, triangle.A, triangle.B, triangle.C)

  const result: OtherTreePoint[] = []
  for (let idx = 0; idx < trees.length; idx++) {
    if (idx === i || idx === j || idx === k) continue
    const p = positions[idx]
    if (!p) continue
    result.push({
      index: idx,
      display: formatTreeDisplay(idx + 1, trees[idx].label),
      pos: mapToLocal(p),
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
  unit: UnitSystem,
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
    detail: `Closest other tree (${worstDisplay}) has ${formatLength(worstClearance, unit)} clearance from the tent footprint.`,
    margin,
  }
}

const CORNER_IDS: VertexId[] = ['A', 'B', 'C']

/**
 * Turns per-corner strap tilt readings into a suggested tie-off height
 * correction to level the platform. The tent corners are already fixed by
 * the fit's geometry (their horizontal reach to each tree is known), so a
 * measured tilt angle converts straight to the vertical drop below wherever
 * that strap is currently tied off: `drop = reach * tan(angle)`. Assuming
 * all three were tied off at roughly the same height to begin with (the
 * usual approach — eyeball a consistent height on each tree before
 * tensioning), unequal drops reveal exactly how far off that eyeballing
 * was: raise or lower each tie-off point by (target − its drop) to bring
 * all three corners level. Needs at least two measured corners to say
 * anything.
 */
export function computeLevelAdjustments(fit: FitResult, angles: LevelAngles): LevelAdjustments {
  const reach: Record<VertexId, number> = { A: fit.reachA, B: fit.reachB, C: fit.reachC }
  const drop: Record<VertexId, number | null> = {
    A: angles.A === null ? null : reach.A * Math.tan(angles.A / DEG),
    B: angles.B === null ? null : reach.B * Math.tan(angles.B / DEG),
    C: angles.C === null ? null : reach.C * Math.tan(angles.C / DEG),
  }

  const knownDrops = CORNER_IDS.map((id) => drop[id]).filter((d): d is number => d !== null)
  if (knownDrops.length < 2) {
    return {
      A: { dropM: drop.A, mountAdjustM: null },
      B: { dropM: drop.B, mountAdjustM: null },
      C: { dropM: drop.C, mountAdjustM: null },
    }
  }

  const target = knownDrops.reduce((sum, d) => sum + d, 0) / knownDrops.length
  const result = {} as Record<VertexId, LevelAdjustment>
  for (const id of CORNER_IDS) {
    const d = drop[id]
    result[id] = { dropM: d, mountAdjustM: d === null ? null : target - d }
  }
  return result as LevelAdjustments
}
