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

export const MIN_TREE_DISTANCE = 5
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
      checks,
      overallVerdict: 'fail',
    }
  }

  const { A, B, C } = triangle
  const trees = [A, B, C]
  const center = fermatPoint(trees)

  const phis = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]
  const radius = settings.tentSide / Math.sqrt(3)

  // Corner A is pinned to the bearing from the center to tree A. Because the
  // center is the Fermat point, the bearings to A, B and C are automatically
  // 120° apart, matching phis exactly — so this single rotation aligns all
  // three corners with their trees at once.
  const theta = Math.atan2(A.y - center.y, A.x - center.x)

  const cornerA: Point = {
    x: center.x + radius * Math.cos(theta + phis[0]),
    y: center.y + radius * Math.sin(theta + phis[0]),
  }
  const cornerB: Point = {
    x: center.x + radius * Math.cos(theta + phis[1]),
    y: center.y + radius * Math.sin(theta + phis[1]),
  }
  const cornerC: Point = {
    x: center.x + radius * Math.cos(theta + phis[2]),
    y: center.y + radius * Math.sin(theta + phis[2]),
  }

  const diameterA = inputs.diameterA ?? DEFAULT_TRUNK_DIAMETER
  const diameterB = inputs.diameterB ?? DEFAULT_TRUNK_DIAMETER
  const diameterC = inputs.diameterC ?? DEFAULT_TRUNK_DIAMETER
  const circumferenceA = Math.PI * diameterA
  const circumferenceB = Math.PI * diameterB
  const circumferenceC = Math.PI * diameterC

  // Strap length is the raw geometric reach from the (Fermat-point-positioned)
  // tent corner to the tree, minus the tail/tether length only. Trunk
  // circumference is deliberately NOT subtracted here — verified against a
  // reference implementation (Tentsile Triangulator) that reports the raw
  // reach; trunk thickness still factors into the max-distance check below.
  const strapA = distance(cornerA, A) - settings.tailLength
  const strapB = distance(cornerB, B) - settings.tailLength
  const strapC = distance(cornerC, C) - settings.tailLength

  // --- Distance checks (min/max tree-to-tree spacing) ---
  const edges: Array<{
    id: string
    label: string
    dist: number
    circumSum: number
  }> = [
    { id: 'edgeAB', label: `${labels.A} ↔ ${labels.B}`, dist: inputs.dAB, circumSum: circumferenceA + circumferenceB },
    { id: 'edgeBC', label: `${labels.B} ↔ ${labels.C}`, dist: inputs.dBC, circumSum: circumferenceB + circumferenceC },
    { id: 'edgeCA', label: `${labels.C} ↔ ${labels.A}`, dist: inputs.dCA, circumSum: circumferenceC + circumferenceA },
  ]

  for (const edge of edges) {
    const maxDist = 2 * settings.strapMax + settings.tentSide - edge.circumSum
    const center = (MIN_TREE_DISTANCE + maxDist) / 2
    const halfRange = (maxDist - MIN_TREE_DISTANCE) / 2
    const margin = halfRange > 0 ? 1 - Math.abs(edge.dist - center) / halfRange : -1
    if (edge.dist < MIN_TREE_DISTANCE) {
      checks.push({
        id: edge.id,
        label: edge.label,
        status: 'fail',
        detail: `${edge.dist.toFixed(2)} m is below the ${MIN_TREE_DISTANCE.toFixed(1)} m minimum for this tent.`,
        margin,
      })
    } else if (edge.dist > maxDist) {
      checks.push({
        id: edge.id,
        label: edge.label,
        status: 'fail',
        detail: `${edge.dist.toFixed(2)} m exceeds the ${maxDist.toFixed(2)} m max reach with a ${settings.strapMax.toFixed(1)} m strap.`,
        margin,
      })
    } else {
      checks.push({
        id: edge.id,
        label: edge.label,
        status: 'pass',
        detail: `${edge.dist.toFixed(2)} m (max reach ${maxDist.toFixed(2)} m).`,
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
  const straps: Array<{ id: string; label: string; value: number }> = [
    { id: 'strapA', label: `Strap to ${labels.A}`, value: strapA },
    { id: 'strapB', label: `Strap to ${labels.B}`, value: strapB },
    { id: 'strapC', label: `Strap to ${labels.C}`, value: strapC },
  ]
  for (const strap of straps) {
    const margin = (settings.strapMax - strap.value) / settings.strapMax
    if (strap.value > settings.strapMax) {
      checks.push({
        id: strap.id,
        label: strap.label,
        status: 'fail',
        detail: `${strap.value.toFixed(2)} m needed, longer than your ${settings.strapMax.toFixed(1)} m strap.`,
        margin,
      })
    } else if (strap.value < 0) {
      checks.push({
        id: strap.id,
        label: strap.label,
        status: 'pass',
        detail: `The tail alone already covers the gap — little to no ratchet strap extension needed, expect slack to take up.`,
        margin,
      })
    } else {
      checks.push({
        id: strap.id,
        label: strap.label,
        status: 'pass',
        detail: `${strap.value.toFixed(2)} m needed.`,
        margin,
      })
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
    checks,
    overallVerdict,
  }
}

/**
 * Reconstructs 2D positions for a grove of trees entered via baseline +
 * trilateration: tree 0 is the origin, tree 1 sets the baseline along +x,
 * and each tree from index 2 onward gives its distance to trees 0 and 1 plus
 * which side of that baseline it's on. A tree with invalid/missing distances
 * gets a null position and an entry in `errors`; every combination that
 * references it is skipped rather than guessed at.
 */
export function buildTreePositions(trees: TreeEntry[]): {
  positions: Array<Point | null>
  errors: string[]
} {
  const positions: Array<Point | null> = []
  const errors: string[] = []

  if (trees.length === 0) return { positions, errors }
  positions.push({ x: 0, y: 0 })
  if (trees.length === 1) return { positions, errors }

  const baseline = trees[1].distToFirst
  if (!(baseline > 0)) {
    errors.push(`${formatTreeDisplay(2, trees[1].label)}: distance must be greater than zero.`)
    positions.push(null)
  } else {
    positions.push({ x: baseline, y: 0 })
  }

  for (let i = 2; i < trees.length; i++) {
    const tree = trees[i]
    const base = positions[1]
    const d0 = tree.distToFirst
    const d1 = tree.distToSecond
    const display = formatTreeDisplay(i + 1, tree.label)
    if (base === null || !(d0 > 0) || !(d1 > 0)) {
      errors.push(`${display}: distances must be greater than zero.`)
      positions.push(null)
      continue
    }
    const b = base.x
    if (b + d0 <= d1 || b + d1 <= d0 || d0 + d1 <= b) {
      const baselineLabel = `${formatTreeDisplay(1, trees[0].label)}-${formatTreeDisplay(2, trees[1].label)}`
      errors.push(
        `${display}: ${d0.toFixed(1)} m and ${d1.toFixed(1)} m don't form a valid triangle with the ${baselineLabel} baseline (${b.toFixed(1)} m).`,
      )
      positions.push(null)
      continue
    }
    const angleAt0 = Math.acos((b ** 2 + d0 ** 2 - d1 ** 2) / (2 * b * d0))
    const side = tree.flipSide ? -1 : 1
    positions.push({ x: d0 * Math.cos(angleAt0), y: side * d0 * Math.sin(angleAt0) })
  }

  return { positions, errors }
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
): {
  combos: ComboResult[]
  positionErrors: string[]
  totalEvaluated: number
  positions: Array<Point | null>
} {
  const { positions, errors } = buildTreePositions(trees)
  const combos: ComboResult[] = []

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
      settings.tentSide,
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
  tentSide: number,
): CheckResult {
  const label = 'Other trees clear of tent'
  if (otherTrees.length === 0) {
    return { id: 'groveObstruction', label, status: 'pass', detail: 'No other grove trees to check.', margin: 1 }
  }

  const radius = tentSide / Math.sqrt(3)
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

  const margin = worstClearance / radius
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
