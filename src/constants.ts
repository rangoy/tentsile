import type { Settings, TreeEntry, TreeReferences } from './types'

export const STINGRAY_SIDE = 4.1
export const CONNECT_LEG = 4
export const CONNECT_BASE = 2.56

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
}

/**
 * Settings persisted before the Connect (non-equilateral) tent shape was added
 * lack tentLegLength/tentBaseLength, and settings persisted before the
 * tail→ratchet rename (v8) lack ratchetLength (they have the old tailLength
 * field instead) — treat either as stale.
 */
export function isValidSettings(value: Settings): boolean {
  return (
    typeof value.tentLegLength === 'number' &&
    typeof value.tentBaseLength === 'number' &&
    typeof value.ratchetLength === 'number'
  )
}

export const DEFAULT_REFERENCES: TreeReferences = { a: 0, b: 1 }

export function isValidReferences(value: TreeReferences): boolean {
  return typeof value.a === 'number' && typeof value.b === 'number' && value.a !== value.b
}
