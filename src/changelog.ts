/**
 * User-facing summary of notable changes, newest first. Deliberately not
 * auto-generated from commit messages — those are written for someone
 * reading a diff, not someone planning a tent pitch. Add an entry here when
 * something changes that a returning user would actually notice.
 */
export interface ChangelogEntry {
  date: string
  items: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-10-02',
    items: [
      'New Undo button (also Ctrl/Cmd+Z) to step back the last tree move or edit — distances, labels, diameters, and flips included.',
      'Trees on the layout diagram are now locked by default, so panning and zooming around can’t accidentally drag one out of place. Tap the lock icon above the diagram to unlock them for editing (moving or adding trees), then lock them again when you’re done.',
    ],
  },
  {
    date: '2026-09-09',
    items: [
      'Importing a backup now merges into what’s already saved instead of replacing it: a location with a matching ID gets updated, a new ID gets added, and anything else already saved is left alone.',
    ],
  },
  {
    date: '2026-09-08',
    items: [
      'Sketch a rough layout before you’ve measured anything: drag trees straight on the diagram to reposition them, tap empty space (or the "+ Tree" button) to add one.',
    ],
  },
  {
    date: '2026-09-04',
    items: [
      'Installable as an app — add it to your home screen and it works offline.',
      'The layout diagram now stays put when you switch between tree combinations, and a new flip button mirrors/flips it to match how you actually walked the site.',
      'New app icon.',
    ],
  },
  {
    date: '2026-09-03',
    items: [
      "4th-tree “floating anchor” option: redirect a corner to a spare tree when its real tree is out of strap reach.",
      'Support for multiple saved locations/groves.',
    ],
  },
  {
    date: '2026-09-02',
    items: [
      'Imperial units (feet/inches) alongside metric, plus the full list of official Tentsile tent models as presets.',
      'Fixed the math for non-equilateral tents (Connect-style), and added a warning when a custom tent isn’t equal-sided.',
    ],
  },
  {
    date: '2026-08-03',
    items: [
      'Tree limit raised to 20 (with a heads-up once checking every combination starts getting slow).',
      'Added an in-app usage guide.',
    ],
  },
  {
    date: '2026-07-24',
    items: [
      'Zoom and pan on the layout diagram, with touch support.',
      'Support for non-equilateral tents.',
      'Pick which two trees are your measurement references, and switch later without re-measuring everything.',
      'Strap-tilt level check, to fine-tune tie-off height once you’re pitching.',
    ],
  },
  {
    date: '2026-07-23',
    items: [
      'First release: enter your candidate trees, see which 3-tree combination fits best, and get the exact strap length needed at each corner.',
    ],
  },
]
