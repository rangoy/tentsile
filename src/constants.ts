import type { Settings, TentModel, TreeEntry, TreeReferences } from './types'

export const STINGRAY_SIDE = 4.1

/**
 * Product dimensions (leg/leg/base, meters) and the isosceles-only strapMax
 * override sourced from the reference app "Tentsile Triangulator"
 * (https://github.com/munifrog/tentsile,
 * `android/app/src/full/java/.../ComposeActivity.java`) rather than
 * re-measured independently — see the "Isosceles hub model" note in
 * geometry.ts for why this app already leans on that source for isosceles
 * math. Two products the reference app also models are deliberately left
 * out: "Universe" (its own source names it `tentsile_test_universe` — a test
 * placeholder, not a shipped product) and "Trilogy" (three equilateral tents
 * clustered around a shared point — a different multi-unit layout this app's
 * single-platform model doesn't represent).
 */
export const VISTA_SIDE = 4.1
export const TRILLIUM_SIDE = 4.1
export const TRILLIUM_XL_SIDE = 6.0
export const CONNECT_LEG = 4.0
export const CONNECT_BASE = 2.7
export const FLITE_LEG = 3.25
export const FLITE_BASE = 2.7
export const UNA_LEG = 2.9
export const UNA_BASE = 1.6
export const UNA_STRAP_MAX = 4.0

export interface TentPreset {
  label: string
  legLength: number
  baseLength: number
  /** only Una ships with a shorter strap by default; every other preset leaves strapMax as the user already had it */
  strapMax?: number
}

export const TENT_PRESETS: Record<Exclude<TentModel, 'custom'>, TentPreset> = {
  stingray: { label: 'Stingray (4.1 m)', legLength: STINGRAY_SIDE, baseLength: STINGRAY_SIDE },
  vista: { label: 'Vista (4.1 m)', legLength: VISTA_SIDE, baseLength: VISTA_SIDE },
  trillium: { label: 'Trillium (4.1 m)', legLength: TRILLIUM_SIDE, baseLength: TRILLIUM_SIDE },
  'trillium-xl': { label: 'Trillium XL (6.0 m)', legLength: TRILLIUM_XL_SIDE, baseLength: TRILLIUM_XL_SIDE },
  connect: { label: 'Connect (4 / 4 / 2.7 m)', legLength: CONNECT_LEG, baseLength: CONNECT_BASE },
  duo: { label: 'Duo (4 / 4 / 2.7 m)', legLength: CONNECT_LEG, baseLength: CONNECT_BASE },
  flite: { label: 'Flite (3.25 / 3.25 / 2.7 m)', legLength: FLITE_LEG, baseLength: FLITE_BASE },
  tmini: { label: 'T-Mini (3.25 / 3.25 / 2.7 m)', legLength: FLITE_LEG, baseLength: FLITE_BASE },
  una: { label: 'Una (2.9 / 2.9 / 1.6 m)', legLength: UNA_LEG, baseLength: UNA_BASE, strapMax: UNA_STRAP_MAX },
}

export const DEFAULT_TREES: TreeEntry[] = [
  { label: '', diameter: null, distToFirst: 0, distToSecond: 0, flipSide: false },
  { label: '', diameter: null, distToFirst: 7.5, distToSecond: 0, flipSide: false },
  { label: '', diameter: null, distToFirst: 8.5, distToSecond: 8, flipSide: false },
  { label: '', diameter: null, distToFirst: 6, distToSecond: 7, flipSide: false },
]

export const DEFAULT_SETTINGS: Settings = {
  tentModel: 'stingray',
  tentLegLength: STINGRAY_SIDE,
  tentBaseLength: STINGRAY_SIDE,
  strapMax: 6,
  ratchetLength: 0.5,
  unitSystem: 'metric',
}

/**
 * Settings persisted before the Connect (non-equilateral) tent shape was added
 * lack tentLegLength/tentBaseLength, settings persisted before the
 * tail→ratchet rename (v8) lack ratchetLength (they have the old tailLength
 * field instead), and settings persisted before the unit-system setting (v12)
 * lack unitSystem — treat any of these as stale.
 */
export function isValidSettings(value: Settings): boolean {
  return (
    typeof value.tentLegLength === 'number' &&
    typeof value.tentBaseLength === 'number' &&
    typeof value.ratchetLength === 'number' &&
    typeof value.unitSystem === 'string'
  )
}

export const DEFAULT_REFERENCES: TreeReferences = { a: 0, b: 1 }

export function isValidReferences(value: TreeReferences): boolean {
  return typeof value.a === 'number' && typeof value.b === 'number' && value.a !== value.b
}
