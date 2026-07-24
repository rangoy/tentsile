import type { Settings, TreeEntry } from './types'

export const STINGRAY_SIDE = 4.1

export const DEFAULT_TREES: TreeEntry[] = [
  { label: '', diameter: null, distToFirst: 0, distToSecond: 0, flipSide: false },
  { label: '', diameter: null, distToFirst: 7.5, distToSecond: 0, flipSide: false },
  { label: '', diameter: null, distToFirst: 8.5, distToSecond: 8, flipSide: false },
  { label: '', diameter: null, distToFirst: 6, distToSecond: 7, flipSide: false },
]

export const DEFAULT_SETTINGS: Settings = {
  tentModel: 'stingray',
  tentSide: STINGRAY_SIDE,
  strapMax: 6,
  tailLength: 0.5,
}
