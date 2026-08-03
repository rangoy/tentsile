export function UsageGuide() {
  return (
    <details className="panel guide-details">
      <summary>How to use this</summary>
      <ol className="guide-list">
        <li>
          <strong>Add your trees.</strong> Pick two as references, measure the distance between
          them, then measure every other tree's distance to both references (plus which side of
          the reference line it's on). Awkward reference pair to measure? Pick a different one —
          the app recomputes everything else automatically.
        </li>
        <li>
          <strong>Check the combo tabs.</strong> Every viable 3-tree combination is ranked and
          color-coded (green = good fit, amber = tight, red = won't fit) — tap a tab to compare.
        </li>
        <li>
          <strong>Read the Layout.</strong> Solid triangle = trees, dashed triangle = the tent,
          dotted lines = straps labeled with the length needed, orange = the fixed ratchet segment.
        </li>
        <li>
          <strong>Check the Result panel.</strong> Strap lengths per corner, plus a full breakdown
          of every pass/tight/fail check below.
        </li>
        <li>
          <strong>On site: use the Level check.</strong> Once you've picked a combo, measure each
          strap's tilt with your phone (or type it in) to get a precise tie-off height correction
          per tree.
        </li>
        <li>
          <strong>Tune settings.</strong> Tent model, max strap length, and ratchet length are all
          editable under "Tent &amp; strap settings".
        </li>
      </ol>
    </details>
  )
}
