# Stingray Tree Tent Pitch Calculator — Specification (Draft v0.1)

## 1. Goal

A small web app that helps someone pitch a Tentsile 3-point tree tent (primarily the
**Stingray**, a 3-person model). The user enters a grove of candidate trees (3 or
more) and the distances between them, and the app:

1. Tells them whether any 3-tree combination from that grove will work, and ranks
   the viable combinations so they can pick the best one.
2. Calculates how long each of the three straps needs to be for the selected
   combination.
3. Visualizes the layout (trees, tent, straps) similar to the diagrams in Tentsile's
   own "Finding Triangles" guide and the general idea of the third-party "Tethered
   Tents" app referenced in Tentsile's "Perfect Pitch" blog post.

## 2. Research summary (source material)

Two sources were reviewed to ground this spec:

- `Tentsile_Finding_Triangles_small.pdf` (Tentsile's own setup-advice sheet)
- `tentsile.com/blogs/news/perfect-pitch` (Tentsile blog post)

Key facts extracted:

- The **product's own triangle side length** ("Trillium/Stingray/Vista") is
  **4.1 m / 13.5 ft**, corner-to-corner. This is the length of one edge of the tent's
  fixed equilateral floor triangle.
- Each corner has a fixed **"ratchet + tail"** segment of **50 cm / 20"** between the
  tent corner and the ratchet buckle, then an adjustable **ratchet strap** (Tentsile
  sells these in ~6 m / 19 ft lengths) that wraps around the tree trunk.
- **Minimum tree-to-tree distance**: 5 m / 16.5 ft for the 3-person products, *unless*
  a basket-loop technique is used (allows closer trees).
- **Maximum tree-to-tree distance** (rule of thumb from the PDF):
  `(2 × ratchet_strap_length + product_side_length) − tree_circumference`
  i.e. `(2 × 6 m + 4.1 m) − TC`.
- **Angles**: Tentsile explicitly says trees don't need to form a "perfect" triangle.
  Guidance:
  - Interior angles well under 90° (their examples show 40°–85°) are comfortable.
  - Exactly 90° is called a **"TIGHT FIT"** — still workable by offsetting the strap
    to the side of the trunk rather than the center (using trunk width to shave off
    some effective angle), plus "~7° of built-in tolerance" in the hardware itself.
  - If no 3 trees work, a **4th "floating anchor" tree** with a spare ratchet/strap
    can redirect one corner's angle.
- Minimum healthy trunk diameter recommended: **30 cm / 12"**.
- The blog post clarifies the actual "Perfect Pitch" tool being referenced is a
  **third-party app called "Tethered Tents"** (iOS/Android, built by a Tentsile
  owner, not Tentsile). Its algorithm is not published — the blog only describes the
  *user experience*: pick your model, enter the three tree-to-tree distances, get a
  strap length per corner. **I do not have access to its actual formula**, so section
  3 below is my own proposed geometric model, not a reverse-engineered copy of theirs.

## 3. Geometric model (v2 — Fermat point)

The tricky part: the tent floor is a **rigid, fixed-shape equilateral triangle**
(all sides = the product's side length), but the trees essentially never form a
matching equilateral triangle. So the tent can't simultaneously point all three
corners exactly at all three trees — or so it seems. Tentsile's own material talks
about "sight-line tags" and fine-tuning tension so the underfloor anti-roll straps
line up with the ratchet straps: the closer that alignment, the tighter/better the
pitch, with ~7° of built-in tolerance in the hardware.

That alignment goal turns out to have an exact answer. The **Fermat (Torricelli)
point** of a triangle is the unique point from which all three vertices are seen
exactly 120° apart — and for any triangle with every interior angle under 120°
(which our own angle checks already require to be under 100° to "pass"), that
point is guaranteed to exist. Since the tent's three corners are also fixed 120°
apart, centering the tent on the tree triangle's Fermat point (instead of its
centroid) and rotating it so one corner's bearing matches — the other two follow
automatically, since both sets of directions are 120° apart — makes **every strap
a straight-line continuation of the tent's own center-to-corner spoke, with zero
bend, for any triangle in the valid range**. This isn't an approximation to fit;
it's the exact position that makes "point every corner straight at its tree"
possible.

v1 model:

1. **Reconstruct tree positions** in a 2D ground plane from the 3 user-entered
   distances (place tree A at origin, tree B along the x-axis, solve tree C via the
   law of cosines). This requires the triangle inequality to hold.
2. **Compute the 3 interior angles** at the trees via the law of cosines.
3. **Position the tent**: find the tree triangle's Fermat point (via Weiszfeld's
   iterative algorithm — the geometric median of the 3 tree positions, which
   coincides with the Fermat point whenever all angles are under 120°), and rotate
   the tent so corner A's bearing from that point matches tree A's bearing — see
   "Overshoot correction (v5)" below for why this isn't always the final answer.
4. **Bend check per corner**: the angle between the tent's center-to-corner spoke
   and the corner-to-tree strap. Expected to be ~0° for any triangle that passes
   the angle checks; flagged tight above 2° and failing above 7° (Tentsile's own
   stated tolerance) as a safety net for edge cases.

**Overshoot correction (v5)**: the Fermat point gives an exact zero-bend fit, but
for some triangle shapes it sits closer to one tree than the tent's own
circumradius (`tentSide / √3`) — the corner would then land *beyond* that tree
entirely, which is physically nonsensical (the strap can't pass through the
trunk) even though the raw math still produces a small positive "reach" number
that looks plausible in isolation. `placeTent()` checks for this and, when it
happens, blends the center back toward the triangle's centroid (computed via
the same rotation-optimizing closed form used before the Fermat point was
introduced — see `optimalRotation()`) just far enough that every corner clears
its tree, using up to the same 7° bend tolerance the per-corner bend check
already allows. If even the full centroid can't clear every tree within that
tolerance, it falls back to the centroid anyway and lets the existing bend
check fail honestly with the real bend value, rather than silently reporting a
geometrically impossible layout. A new **Tent fit** check per corner reports
the clearance directly (or fails outright if a corner still overshoots even at
the centroid) so this is visible in `checks`, not just inferred from the
diagram.
5. **Reach per corner** = straight-line distance from the positioned tent
   corner to its tree. Neither the ratchet length nor trunk circumference is
   subtracted from this number — it's the raw geometric reach.
6. **Validation checks**:
   - Triangle inequality (must form a real triangle at all).
   - Each side length within [min distance, max distance] from §2 (see
     "Ratchet handling" below for how the ratchet affects the max).
   - Each interior angle flagged: OK (<80°), tight fit (80–100°), fail (>~100°,
     configurable).
   - Strap-only length (reach minus ratchet) within [0, max strap length] —
     see "Ratchet handling" below.
   - Trunk diameter ≥ 30 cm (if entered).
   - Bend per corner, per step 4 above.
   - Tent fit per corner (no overshoot past the tree), per "Overshoot correction" above.
7. **Verdict**: overall pass / tight-fit-but-workable / fail, with a specific reason
   per failing constraint (e.g. "Tree A–Tree B is 9.2 m, which exceeds the 8.4 m max
   for a 6 m strap").

This is an approximation of real-world tensioned-webbing physics (it assumes taut,
straight-line straps and ignores sag/catenary effects and strap stretch), which
should be good enough for field planning purposes.

**Validated against a reference implementation**: a third-party app ("Tentsile
Triangulator") that appears to implement this same "point every corner straight at
its tree" idea was found and cross-checked against a real example (6/9/8 m tree
distances, Stingray 4.1 m tent): our raw geometric reach per corner matched its
displayed strap lengths exactly (3.86 m / 1.72 m / 0.43 m). This is strong evidence
the Fermat point model in §3 is not just a reasonable approximation but the actual
approach real tools use — the "reach" figure in step 5 is exactly this raw distance,
unaffected by the ratchet-length setting.

**Ratchet handling (v3, terms updated v8)**: the ratchet is a fixed length of
hardware between the tent corner and the strap, in series with the adjustable
strap — a separate physical piece, not drawn from the same length budget as the
strap. (Terminology note: this app calls the fixed ~0.5 m piece "ratchet" and
the adjustable ~6 m webbing "strap" — see the decisions log entry "Terminology
cleanup (v8)".) So it's handled entirely as a derived, secondary figure rather
than being subtracted from the primary "reach":

- `strap = reach − ratchetLength` — the strap-only length needed. Shown in
  parentheses next to the main reach figure (e.g. `2.26 m (1.76 m)`), and only
  once `ratchetLength > 0`.
- The **strap-length check** (§6) compares `strap`, not raw `reach`, against the
  max strap length setting — since the max is a property of the strap alone. A
  `reach` that exceeds the max but whose `strap` doesn't is a **pass**, not a
  fail (this was a bug in an earlier iteration: `reach` was being checked
  directly against the max, effectively double-counting the ratchet as part of
  the strap's own budget).
- The **max-distance-per-edge check** (§2's rule of thumb) similarly needs the
  ratchet added back in: each corner's true max reach is `ratchetLength +
  strapMax`, not just `strapMax`, so the maximum edge distance is
  `2 × (strapMax + ratchetLength) + tentSide − circumference`. A distance beyond
  the no-ratchet max (`2 × strapMax + tentSide − circumference`) but within this
  ratchet-inclusive max is flagged **tight** (relies on the ratchet's reach to
  work) — the same bug as above, applied to the edge-distance check.
- If `strap < 0` (the tree is closer than the ratchet itself reaches), the
  standard ratchet+strap setup doesn't apply — a **basket loop** is needed
  instead (loop the strap directly around the tree, skipping the ratchet
  entirely). Flagged as **tight** (workable, just a different technique), not
  fail, with a link to Tentsile's own basket-loop guide
  (`tentsile.com/pages/guides-tips-tricks#closetrees`) next to the message.
  This and the strap-length check above are reported as a single "Strap to X"
  check per corner (not two) — they're really two boundaries on the same strap.
- Default ratchet length is **0.5 m** (Tentsile's "ratchet + tail" hardware spec
  from §2), not 0 — 0 just turns off all of the above (no parenthetical, no
  basket-loop check, checks against raw reach directly).
- The **5 m minimum edge distance** from §2 is no longer a hard fail: Tentsile's
  own guidance is that it only applies *without* a basket loop, and the
  per-corner basket-loop check above already covers that case more precisely
  (using the tent's actual ratchet length rather than a flat constant). Short
  distances now just show up as a `tight` basket-loop note at the affected
  corners instead of an unconditional edge-level fail.

## 3b. Multi-tree grove & best-fit ranking (v2)

Real groves often have more than 3 usable trees. Rather than force the user to
measure every pairwise distance (O(N²), tedious for larger groves), trees are
entered via **baseline + trilateration**:

- Two trees are designated as **references** — just the distance between them.
  By default these are the first two added, but any pair can be picked (see
  "Choosing the reference pair" below) — useful when the default pair happens to
  be awkward to measure between (obstructed sightline, awkward terrain, etc.).
- Every other tree gives its distance to *both* references (2 measurements, not 1
  per additional tree), which is enough to place it via the same law-of-cosines
  circle intersection already used for the 3-tree case.

This is O(N) measurements instead of O(N²), at the cost of one ambiguity: a tree's
distance to the two references alone doesn't say which side of the reference-pair
line it's on. That only matters for inferring the distance *between two* such
extra trees (their own distances to the references are exact regardless) — so
each extra tree has a "flip to the other side" checkbox to resolve it if needed.

**Choosing the reference pair**: two dropdowns ("Reference A" / "Reference B", each
excluding whichever tree the other has selected, so picking the same tree for both
is impossible by construction rather than needing an error message for it) let the
user designate any two trees as the anchor pair, independent of their position in
the list — no reordering, so tree numbers stay stable. Changing the pair doesn't
just relabel two dropdowns: every tree's `distToFirst`/`distToSecond`/`flipSide`
fields are defined *relative to whichever trees are currently references*, so the
meaning of every other tree's fields shifts too (including the old references,
which now need distances of their own). Asking the user to re-measure everything
after a simple preference change would defeat the point, so `recomputeTreesForReferences()`
derives the new values automatically: it builds every tree's position under the
*old* reference pair (fully determined already, assuming that data was valid),
finds the rigid transform mapping the *new* pair onto the origin/+x-axis, and
re-derives each tree's distances and flip-side in that new frame — exact up to
floating point, since a rigid transform preserves all pairwise distances. If the
old geometry doesn't have valid positions for both new references (missing or
invalid prior measurements), there's no frame to derive from, and the switch is
declined with an explanatory message rather than silently producing wrong numbers.
Removing a tree that's currently a reference is blocked in the UI (the recompute
model doesn't need to handle that case); removing any other tree still shifts the
stored reference indices down by one wherever they'd otherwise now point at the
wrong (shifted) tree.

**Finding the best combination**: every 3-tree combination (up to `C(8,3) = 56` for
the 8-tree cap) is run through the same `computeFit` used for the original 3-tree
case, then ranked by **largest safety margin**. Each check (distance range, angle,
strap length, bend, trunk diameter) is given a normalized margin — 0 at the fail
boundary, ~1 at the ideal center, negative when failing — and a combination's score
is the *minimum* margin across its checks (its tightest constraint). Combinations
are sorted pass-before-tight-before-fail, then by that score descending. This
favors the most robust pitch, not just a technical pass.

The top 5 combinations are shown as colored tabs (e.g. `1/2/3`, `1/2/4` — just the
trees' 1-based positions, color-coded pass/tight/fail) docked at the top of the
Layout card; selecting one drives the existing results panel and visualization
unchanged — they only ever render a single resolved 3-tree fit, they just don't
know or care whether those 3 trees came from a fixed A/B/C form or were picked out
of a larger grove.

**Tree identity**: a tree's identity is its 1-based position in the grove (1, 2, 3,
...) — stable, always visible, never edited. The free-text field next to it is an
*optional* label, empty by default; wherever a tree is named in the UI (tab tooltip,
layout marker, results rows, check text) it's formatted as `formatTreeDisplay()`:
just the number, or `number (label)` if a label was entered.

**Rendering the whole grove**: the visualization also plots every grove tree not in
the selected combination, as a muted gray point, for spatial context. Since the
visualization works in the local coordinate frame the selected combination's own
`solveTriangle` call builds (tree A at the origin, B on the x-axis), while other
trees only have positions in the grove's global baseline frame, a small 2-point
similarity transform (rotation + translation + mirror-if-needed) bridges the two —
built once per render from the 2 frames' shared reference points, since both
triangles have identical pairwise distances by construction.

**Obstruction check**: a 3-tree combination can check out geometrically while still
being physically unusable, if a 4th (or 5th, ...) grove tree happens to stand inside
the tent's own footprint. Using the same local-frame positions built for rendering,
each non-selected tree's position is tested against the tent's 3 corners (point-in-
triangle via edge cross-product signs, plus signed distance-to-nearest-edge for
trees just outside it), with that tree's own trunk radius subtracted from the
clearance so a tree grazing the edge still counts as an obstruction. This becomes
one more entry in `checks` (id `groveObstruction`) — fed into `overallVerdict` and
the ranking's margin score exactly like every other check — so a combination with
an obstructing tree is correctly ranked below/failed relative to one without,
without the ranking or results-display code needing to know this check exists. The
obstructing tree (if any) is also highlighted red with a ⚠ in the visualization.

Cap: **8 trees**. `C(8,3) = 56` combinations is instant client-side, and the
pairwise-adjacent measuring burden (2 distances per extra tree) stays reasonable.

## 3c. Non-equilateral tent shapes (v5)

The Stingray's floor is equilateral, which is what makes the Fermat point exact:
its corners are 120° apart, exactly matching the angle at which the Fermat point
sees all three trees, so *any* triangle can be pointed at with zero bend. Other
Tentsile models (e.g. the 2-person **Connect**) use an **isosceles** floor instead
— two equal "leg" sides and a third "base" side that's shorter (4 m / 4 m / 2.56 m
for the Connect). The tent shape is now `tentLegLength` + `tentBaseLength` in
settings (equal for an equilateral tent — the Stingray is just that special case),
with a model dropdown offering **Stingray**, **Connect**, or **Custom**.

An isosceles tent's corners are *not* 120° apart, so there's generally no point
from which the trees are seen at exactly its (unequal) corner angles — perfect
zero-bend fits stop being achievable in most cases. This is physically correct
(an asymmetric floor genuinely can't always point straight at three arbitrary
trees), not a bug. The model still centers on the trees' Fermat point and picks
the best-fit rotation there (unchanged from §3) rather than searching for a
better center — asymmetric tents will more often show a small nonzero "tight"
bend instead of a perfect 0°, which is an honest result, just not the tightest
theoretically possible one.

Because the tent's own corners are no longer interchangeable (the corner opposite
the base is geometrically distinct from the other two), *which* tree plays which
corner role now matters. `computeFit` tries all 6 ways to assign the 3 trees to
the tent's 3 fixed corner roles, and keeps whichever assignment overshoots the
fewest trees, then bends the least. For an equilateral tent all 6 give an
identical result (nothing changes for the Stingray); for an isosceles one, only
the 3 matching the tent's own chirality can fit well — a physical tent can be
rotated in place but not mirrored (that would flip it upside down), so the other
3 simply score worse and lose without needing special-casing. The winning
assignment also determines which of the tent's own (now possibly-different) edge
lengths feeds the §2 max-distance-per-edge rule of thumb for each tree pair,
replacing the single shared `tentSide` constant used previously.

## 4. Inputs (final)

- A grove of 3–8 trees (add/remove trees in the UI). Two trees are designated as
  references (default: the first two added, but any pair can be picked — see
  §3b "Choosing the reference pair"); each other tree gives distances to both
  references, plus a "flip side" toggle (see §3b). Each tree also has an optional
  free-text label (empty by default — see §3b "Tree identity").
- Tent side length: preset **Stingray = 4.1 m**, with an editable custom value.
- Strap max length (default 6 m, editable).
- Ratchet length (default 0.5 m, editable).
- Optional per-tree trunk diameter (defaults to 40 cm if left blank), used for the
  ≥30 cm minimum check and the wrap-allowance subtracted from max distance / strap
  length.
- All settings (trees, reference pair, tent side length, strap length, ratchet
  length) persisted to `localStorage` so they survive a reload.
- Units: **metric only** (meters/centimeters), no imperial toggle.
- No height/elevation inputs in v1 — flat 2D ground-plane model only.

## 5. Outputs

- Ranked tabs for viable 3-tree combinations, atop the Layout card (§3b).
- Pass/fail/tight-fit verdict with human-readable reasons for the selected one.
- Reach required per corner (A, B, C), with the strap-only length in
  parentheses once a ratchet length is set (§3 "Ratchet handling"), or a
  basket-loop note if the tree is closer than the ratchet itself.
- Computed interior angles per tree.
- Whether any other grove tree obstructs the tent footprint (§3b).
- Visualization (see §6).

## 6. Visualization

Top-down 2D plan view (SVG, via D3), modeled on the PDF diagrams. Combination tabs
(§3b) sit directly above it, inside the same card, so switching combinations and
verifying the result visually don't require scrolling.

- Solid triangle = the selected combination's trees (circles sized/labeled by trunk
  diameter if given).
- Dashed triangle = the tent, in its computed (Fermat point) position.
- Dotted lines from each tent corner to its tree = the straps, labeled with computed
  reach (strap-only length in parentheses, or "basket loop" — see §3 "Ratchet
  handling").
- Orange segment at the tent-corner end of each strap = the fixed ratchet, drawn
  only once `ratchetLength > 0` and only when a basket loop isn't needed (there's
  no separate ratchet segment in that case).
- Gray dashed lines = tent center to each corner, for comparing strap alignment.
- Faint gray points = other grove trees not in the selected combination (§3b).
- Angle labels at each tree vertex.
- Color coding for pass / tight-fit / fail per constraint.

**Zoom & pan (v4)**: scroll wheel or pinch to zoom, drag to pan, plus +/− and
"Reset view" buttons overlaid on the diagram. Built as a standalone `useZoomPan`
hook (`src/useZoomPan.ts`) rather than d3-zoom, to avoid mixing D3's imperative
DOM-event binding with React's rendering — it just tracks a `{x, y, scale}`
camera in React state and applies it as a `transform` on a single `<g>` wrapping
all the diagram's content, using the Pointer Events API so mouse and touch share
one code path (pinch-zoom tracks up to two simultaneous pointers). The camera
resets to default when the selected combination changes, but persists across
minor input edits within the same combination.

A few non-obvious fixes were needed to get this right:
- React's synthetic `onWheel` can end up bound as a passive listener
  (browser-dependent), silently ignoring `preventDefault()` and letting the
  *page* scroll underneath the diagram. Fixed with a native
  `addEventListener('wheel', handler, { passive: false })` via `useEffect`
  instead of a JSX `onWheel` prop.
- `setPointerCapture` throws for synthetic/edge-case pointers; wrapped in
  try/catch so it can't abort the rest of the handler.
- Dragging to pan would otherwise start a native text selection — fixed with
  `user-select: none` on the SVG.
- Labels (tree numbers, strap lengths, angles) are wrapped in a small
  `ScreenSpace` helper that anchors them at their diagram position but
  counter-scales by `1/cameraScale`, so they stay a constant, legible size
  while the surrounding geometry (trees, straps, tent) scales normally with
  zoom — the point of zooming in is to give the *geometry* more room, not to
  blow up text until it collides with itself.

## 6b. Level check (v7)

Once a combination is selected, an optional "Level check" section (below the
strap lengths, in the Result card) helps with the *last* part of pitching:
correcting for an eyeballed tie-off height once all three straps are attached.
In practice all three straps get tied off at roughly the same height on their
trees by eye — this tool measures how far off that guess actually was and
turns it into a precise per-tree correction, rather than the (imprecise, and
usually smaller-range) ratchet adjustment.

- For each corner, the user measures the strap's tilt — how far it declines
  from horizontal between the tree and the tent corner — either by tapping
  "Measure" (reads the phone's tilt via `DeviceOrientationEvent`, holding the
  phone flat against the strap webbing, screen up, top edge toward the tree)
  or by typing the angle in directly.
- The horizontal reach per corner is already known from the fit (`strapA/B/C`
  — the flat 2D plan-view distance), so each measured angle converts to an
  implied vertical drop below that tree's current tie-off point: `drop =
  reach * tan(angle)`.
- Since the tent corners are fixed by the geometry, a level platform means
  equal drop at all three corners; unequal drops are exactly the tie-off
  height error. The tool reports, per corner, how many centimeters to raise
  or lower its tie-off point (`target average drop − this corner's drop`) —
  needs at least two corners measured to compute a target.
- iOS gates `DeviceOrientationEvent` behind an explicit permission prompt that
  must be triggered by a user gesture — the "Measure" tap itself requests it
  on first use (`useDeviceTilt` hook). Android/desktop browsers generally
  expose it without a prompt. Manual angle entry always works as a fallback,
  including on devices/browsers without the sensor at all.
- This doesn't add height/3D to the core geometry model (§8 still applies to
  the fit computation itself) — it's a self-contained field-assist tool
  layered on top of the existing flat-plan strap-reach numbers.

## 7. Tech stack (final)

- Single-page app, client-side only (no backend needed — pure geometry/math).
- React for structure/state + D3 for the SVG visualization (D3 used for scales/path
  generation, not for DOM-driven rendering, to avoid React/D3 fighting over the DOM).
- Build tooling: Vite + TypeScript.
- `localStorage` for persisting settings (tent size, strap/ratchet length, last-entered
  distances and trunk diameters).
- Deploy target: **local dev only for now** (`npm run dev`); static hosting decided
  later.

## 8. Out of scope for v1 (final)

- Imperial units.
- 3D / height modeling (attachment height vs. tent hang height) — flat 2D only.
- 4th "floating anchor" tree fallback scenario.
- Uneven terrain / per-tree ground elevation.
- Anti-roll strap calibration.
- Multi-tent/hammock stacking configurations.
- Support for other Tentsile models beyond Stingray and Connect (UNA, Flite, Universe).

## 9. Decisions log

All open questions from the draft have been resolved:

| Question | Decision |
|---|---|
| Tech stack | React + D3, Vite + TypeScript |
| Height/3D | Flat 2D only for v1 |
| Geometry model | Centroid-centered, rotation-optimized fit (§3), as proposed |
| Tent model scope | Stingray preset (4.1 m) + custom override, saved to localStorage |
| Units | Metric only |
| Trunk input | Optional per-tree diameter field, default 40 cm |
| Strap/ratchet settings | Editable, persisted to localStorage |
| Deployment | Local dev only for now |
| Multi-tree distance input (v2) | Baseline + 2 distances per extra tree, with a flip-side toggle to resolve the resulting ambiguity |
| Best-fit ranking (v2) | Largest safety margin (minimum per-check margin), pass > tight > fail |
| Results display (v2) | Ranked list of top 5 combinations, selectable |
| Tree count cap (v2) | 8 trees |
| Mobile layout (v3) | Compact tree table, Layout card on top, collapsible checks/settings/legend |
| Combo display (v3) | Color-coded tabs (`1/2/3` format) docked atop the Layout card, replacing the ranked list |
| Tree identity (v3) | 1-based position is the stable identity; free-text label is optional, empty by default, shown as `number (label)` when set |
| Ratchet handling (v3) | Reach stays raw (unaffected by the ratchet); strap-only length (reach − ratchet) is a derived, secondary figure shown in parentheses; strapMax and max-edge-distance checks apply to the ratchet-adjusted figures, not raw reach |
| Basket loop (v3) | `strap < 0` flags `tight` (not fail) with a link to Tentsile's basket-loop guide; the flat 5 m minimum edge distance was removed since this per-corner check covers it more precisely |
| Zoom/pan (v4) | Custom `useZoomPan` hook (not d3-zoom), full touch support via Pointer Events, constant-size labels via counter-scaling |
| Overshoot correction (v5) | Blend center from Fermat point toward centroid, using up to the 7° bend tolerance, until no corner overshoots past its tree; new per-corner "Tent fit" check reports clearance or fails honestly if even the centroid can't clear within tolerance |
| Reference pair selection (v6) | Two dropdowns pick any tree pair as references, decoupled from list order (rejected: reordering the list — would silently renumber every tree); changing the pair auto-recomputes every other tree's distances/flip-side from the previously-known geometry rather than asking for re-measurement, declining with an explanatory message if the old geometry can't support it |
| Level check (v7) | Assume equal strap starting height on all three trees (matches recommended pitching technique) rather than asking the user to also enter each tree's attachment height — keeps the tool to a single tilt reading per corner instead of doubling the inputs; adjustment is expressed as centimeters to move the tie-off point on the trunk (correcting the eyeballed height directly), not as a ratchet strap-length change |
| Terminology cleanup (v8) | Renamed the fixed ~0.5 m hardware from "tail/tether" to **ratchet**, and the adjustable ~6 m webbing from "ratchet strap" to **strap** (diverges from Tentsile's own "ratchet + tail" phrasing from §2, kept for in-app clarity); merged the separate "Strap to X" (too-long) and "Tail fit at X" (basket-loop) checks into one "Strap to X" check per corner, since both were really describing bounds on the same strap |

Spec is considered final for the current implementation.
