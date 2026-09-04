export interface Point {
  x: number
  y: number
}

export type VertexId = 'A' | 'B' | 'C'

export interface TreeInputs {
  /** distance between tree A and tree B, in meters */
  dAB: number
  /** distance between tree B and tree C, in meters */
  dBC: number
  /** distance between tree C and tree A, in meters */
  dCA: number
  /** trunk diameter at strap height, in meters (optional per tree) */
  diameterA: number | null
  diameterB: number | null
  diameterC: number | null
}

export type TentModel =
  | 'stingray'
  | 'vista'
  | 'trillium'
  | 'trillium-xl'
  | 'connect'
  | 'duo'
  | 'flite'
  | 'tmini'
  | 'una'
  | 'custom'

/** Display/input unit only — every stored measurement stays in meters regardless (see units.ts). */
export type UnitSystem = 'metric' | 'imperial'

export interface Settings {
  tentModel: TentModel
  /**
   * The tent's fixed floor shape is an isosceles triangle: two equal "leg"
   * sides and one "base" side that may be shorter (or, for an equilateral
   * tent like the Stingray, equal to the legs). Both in meters.
   */
  tentLegLength: number
  tentBaseLength: number
  /** maximum (adjustable) strap length, in meters */
  strapMax: number
  /** fixed ratchet length between tent corner and strap, in meters */
  ratchetLength: number
  unitSystem: UnitSystem
}

export type CheckStatus = 'pass' | 'tight' | 'fail'

export interface CheckResult {
  id: string
  label: string
  status: CheckStatus
  detail: string
  /** normalized safety margin: 0 = right at the fail boundary, negative = failing, ~1 = ideal */
  margin: number
}

export interface TreeLabels {
  A: string
  B: string
  C: string
}

/**
 * One tree in a grove of up to MAX_TREES candidates. Trees are entered via
 * baseline + trilateration rather than a full pairwise distance matrix: two
 * trees are designated as references (see TreeReferences — by default the
 * first two, but any pair can be chosen, e.g. when the default pair happens
 * to be awkward to measure between), and every other tree gives its distance
 * to both reference trees plus which side of the reference-pair line it's on
 * (this last part only matters for inferring the distance between two
 * non-reference trees, since their own distances to the references are given
 * directly).
 */
export interface TreeEntry {
  /** optional free-text label, empty by default — the tree's identity is its 1-based position */
  label: string
  diameter: number | null
  /** meters to reference A (unused for a tree currently acting as reference A) */
  distToFirst: number
  /** meters to reference B (unused for a tree currently acting as either reference) */
  distToSecond: number
  /** true = mirrored to the other side of the reference-pair line */
  flipSide: boolean
}

/** Which two grove trees (by index) anchor the coordinate system the rest are measured against. */
export interface TreeReferences {
  a: number
  b: number
}

/**
 * One saved grove (a physical site with its own set of candidate trees).
 * Tent/strap `Settings` are deliberately global, not per-location — they
 * describe which tent you own, not where you're pitching it.
 */
export interface Location {
  id: string
  name: string
  trees: TreeEntry[]
  references: TreeReferences
  /**
   * Distance-only trilateration can't tell a layout from its mirror image,
   * and the app has no compass data either — it has to pick some arbitrary
   * orientation (see solveTriangle/buildTreePositions in geometry.ts). These
   * two flip the *displayed* diagram left-right and/or top-to-bottom to
   * match how the user actually walked the site, without touching any of the
   * underlying math (strap lengths, angles, checks are orientation-invariant).
   * Optional/absent on locations saved before this existed — treat as false.
   */
  mirrored?: boolean
  flippedVertically?: boolean
}

/** A grove tree not part of the currently selected combo, positioned in that combo's local frame purely for display. */
export interface OtherTreePoint {
  /** index into the trees array */
  index: number
  /** formatted as "<number>" or "<number> (<label>)" — see formatTreeDisplay */
  display: string
  pos: Point
  diameter: number | null
}

export interface ComboResult {
  /** indices into the trees array, e.g. [0, 2, 3] */
  indices: [number, number, number]
  labels: TreeLabels
  fit: FitResult
  /** the worst (minimum) per-check margin across the combo's fit — used for ranking */
  marginScore: number
}

export interface TriangleSolution {
  valid: boolean
  reason?: string
  A: Point
  B: Point
  C: Point
  /** interior angle at each vertex, in degrees */
  angleA: number
  angleB: number
  angleC: number
}

/** Measured strap tilt per corner, in degrees (positive = descending from tree to corner); null = not yet measured */
export interface LevelAngles {
  A: number | null
  B: number | null
  C: number | null
}

export interface LevelAdjustment {
  /** implied drop below the tree attachment point, in meters; null if this corner's angle is unmeasured */
  dropM: number | null
  /** meters to raise (positive) or lower (negative) this tree's tie-off point to level the platform; null if not computable */
  mountAdjustM: number | null
}

export interface LevelAdjustments {
  A: LevelAdjustment
  B: LevelAdjustment
  C: LevelAdjustment
}

export interface FitResult {
  triangle: TriangleSolution
  center: Point
  /** optimal tent rotation, in radians */
  theta: number
  cornerA: Point
  cornerB: Point
  cornerC: Point
  /** raw geometric reach per corner, in meters (no ratchet or trunk wrap subtracted) */
  reachA: number
  reachB: number
  reachC: number
  /** strap-only length per corner, in meters (reach minus the fixed ratchet; negative = basket loop needed) */
  strapA: number
  strapB: number
  strapC: number
  checks: CheckResult[]
  overallVerdict: CheckStatus
}

/**
 * A 4th-tree "floating anchor" redirect for one corner of an otherwise-normal
 * 3-tree fit (see computeFloatingAnchor in geometry.ts): a ratchet loop
 * grabs the corner's own strap partway along its length and pulls it
 * sideways toward a spare tree — the strap still continues on to its own
 * real tree past that point (bent there), it isn't cut short.
 */
export interface FloatingAnchorResult {
  /** which of the fit's 3 corners is being redirected */
  cornerId: VertexId
  /** the grab/redirect point's position, in the same local frame as the base fit's triangle */
  virtualPoint: Point
  /**
   * The redirected corner's fit. `reach{cornerId}`/`strap{cornerId}` now
   * report the *bent* total path length (corner -> grab point -> the real
   * tree, i.e. `cornerToGrabReach + grabToTreeReach`) rather than a straight
   * line — every other check (angles, the other two corners' bend/reach,
   * trunk diameter, etc.) is otherwise identical to a normal 3-tree fit. Two
   * caveats specific to the redirected corner: its own trunk-diameter check
   * is skipped (a grab point has no trunk), and its edge-distance checks
   * subtract a trunk circumference at an end that isn't really a tree — both
   * are noted in the UI rather than special-cased here (see
   * FloatingAnchor.tsx).
   */
  fit: FitResult
  /** corner -> grab point distance, in meters (the first of the two bent segments making up the strap to the corner's own real tree) */
  cornerToGrabReach: number
  /** grab point -> the corner's own real tree, in meters (the strap continuing on past the grab point, not stopping there) */
  grabToTreeReach: number
  /** grab point -> the real 4th tree, in meters (the new pull strap) */
  redirectReach: number
  /** strap-only portion of redirectReach, in meters (see FitResult.strapA and friends) */
  redirectStrap: number
  /** angle (0-180°) at the grab point between the pull strap and the redirected corner's own strap (corner -> grab point) — purely informational, whatever a real frictionless loop under tension settles at */
  redirectAngleDeg: number
}

/** UI state for the floating-anchor controls — lifted to App so both FloatingAnchor and Visualization can share it. */
export interface FloatingAnchorState {
  enabled: boolean
  cornerId: VertexId
  /** index into the trees array of the redirect (4th) tree; null until otherTrees is known */
  redirectIndex: number | null
  /**
   * How tight the pull strap is cranked, 0-100. 0 = loosest — the loop
   * settles exactly at the corner's own real tree, matching the un-redirected
   * fit exactly ("loosely attach," nothing has happened yet). 100 = tightest
   * — the loop is pulled all the way to the redirect tree itself. See
   * computeFloatingAnchor in geometry.ts for why this single number, rather
   * than a separate grab-point position, is enough: a frictionless loop's
   * equilibrium position isn't an independent choice, it falls out of the
   * deployed pull-strap length alone.
   */
  tightness: number
}
