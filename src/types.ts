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

export type TentModel = 'stingray' | 'connect' | 'custom'

export interface Settings {
  tentModel: TentModel
  /**
   * The tent's fixed floor shape is an isosceles triangle: two equal "leg"
   * sides and one "base" side that may be shorter (or, for an equilateral
   * tent like the Stingray, equal to the legs). Both in meters.
   */
  tentLegLength: number
  tentBaseLength: number
  /** maximum ratchet strap length, in meters */
  strapMax: number
  /** fixed tail/tether length between tent corner and ratchet buckle, in meters */
  tailLength: number
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

/** A grove tree not part of the currently selected combo, positioned in that combo's local frame purely for display. */
export interface OtherTreePoint {
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

export interface FitResult {
  triangle: TriangleSolution
  center: Point
  /** optimal tent rotation, in radians */
  theta: number
  cornerA: Point
  cornerB: Point
  cornerC: Point
  /** raw geometric reach per corner, in meters (no tail or trunk wrap subtracted) */
  strapA: number
  strapB: number
  strapC: number
  /** ratchet-only length per corner, in meters (strap minus the fixed tail; negative = basket loop needed) */
  ratchetA: number
  ratchetB: number
  ratchetC: number
  checks: CheckResult[]
  overallVerdict: CheckStatus
}
