import { formatLength } from '../units'
import type { CheckResult, FloatingAnchorResult, FloatingAnchorState, OtherTreePoint, TreeLabels, UnitSystem, VertexId } from '../types'

interface Props {
  state: FloatingAnchorState
  onChange: (patch: Partial<FloatingAnchorState>) => void
  /** re-solves for the least tightness that reaches a clean "Good fit" at the current corner/tree — see solveFloatingAnchorTightness in geometry.ts */
  onAutoFit: () => void
  result: FloatingAnchorResult | null
  redirectTree: OtherTreePoint | null
  otherTrees: OtherTreePoint[]
  labels: TreeLabels
  ratchetLength: number
  unitSystem: UnitSystem
}

const CORNERS: VertexId[] = ['A', 'B', 'C']
const VERDICT_COPY: Record<CheckResult['status'], string> = {
  pass: 'Good fit',
  tight: 'Tight fit — workable with adjustment',
  fail: "Won't fit as measured",
}

function formatSegment(reach: number, strap: number, ratchetLength: number, unit: UnitSystem): string {
  const main = formatLength(reach, unit)
  if (ratchetLength <= 0) return main
  if (strap < 0) return `${main} (basket loop)`
  return `${main} (${formatLength(strap, unit)})`
}

/**
 * A generic, made-up-numbers illustration of the technique — not the live
 * data (that's what the Layout diagram above already draws once this is
 * enabled). Colors match the Layout diagram's own Legend: purple for the
 * redirect-specific pieces (grab point, pull strap, 4th tree), a plain dark
 * line for the corner's own strap.
 */
function Illustration() {
  const corner = { x: 30, y: 150 }
  const realTree = { x: 300, y: 60 }
  const tree4 = { x: 108, y: 30 }
  // The grab point: a spot partway along the corner→realTree strap, pulled
  // toward tree4 — mirrors the actual model (computeFloatingAnchor) rather
  // than an arbitrary illustration point, so the bend reads the same way.
  const along = { x: corner.x + (realTree.x - corner.x) * 0.55, y: corner.y + (realTree.y - corner.y) * 0.55 }
  const grab = { x: along.x + (tree4.x - along.x) * 0.35, y: along.y + (tree4.y - along.y) * 0.35 }

  return (
    <svg
      viewBox="0 0 340 190"
      className="floating-anchor-illustration"
      role="img"
      aria-label="Diagram: the tent corner's own strap runs to its real tree as normal, but a loop partway along it is pulled sideways by a second strap to a 4th tree, bending the strap at that loop."
    >
      <line
        x1={corner.x}
        y1={corner.y}
        x2={realTree.x}
        y2={realTree.y}
        stroke="var(--border)"
        strokeWidth={1.5}
        strokeDasharray="4 4"
      />
      <line x1={corner.x} y1={corner.y} x2={grab.x} y2={grab.y} stroke="var(--text)" strokeWidth={2.5} />
      <line x1={grab.x} y1={grab.y} x2={realTree.x} y2={realTree.y} stroke="var(--text)" strokeWidth={2.5} />
      <line x1={grab.x} y1={grab.y} x2={tree4.x} y2={tree4.y} stroke="#8e44ad" strokeWidth={2.5} strokeDasharray="5 4" />

      <rect x={corner.x - 7} y={corner.y - 7} width={14} height={14} rx={2} fill="var(--text)" />
      <circle cx={realTree.x} cy={realTree.y} r={9} fill="#5a3d1e" stroke="#2e2010" strokeWidth={1.5} />
      <circle cx={tree4.x} cy={tree4.y} r={9} fill="#5a3d1e" stroke="#2e2010" strokeWidth={1.5} />
      <circle cx={grab.x} cy={grab.y} r={5.5} fill="white" stroke="#8e44ad" strokeWidth={2.5} />

      <text x={corner.x} y={corner.y + 26} textAnchor="middle" fontSize={11} fill="var(--text)">
        Corner
      </text>
      <text x={realTree.x} y={realTree.y + 26} textAnchor="middle" fontSize={11} fill="var(--text)">
        Real tree
      </text>
      <text x={tree4.x} y={tree4.y - 16} textAnchor="middle" fontSize={11} fill="var(--text)">
        4th tree
      </text>
      <text x={grab.x + 14} y={grab.y + 6} textAnchor="start" fontSize={11} fill="var(--text)">
        Grab point (loop)
      </text>
    </svg>
  )
}

/**
 * A 4th-tree "floating anchor" redirect for one corner — see
 * computeFloatingAnchor in geometry.ts for the physical technique and the
 * math. Opt-in and self-contained: doesn't touch the main fit/ranking, only
 * offers an alternate what-if view for the currently selected combination.
 * Controlled from App (state lives there) so the Layout diagram can draw the
 * same redirect this panel describes.
 *
 * A single "tightness" slider, not a grab-point-plus-pull-length pair: a
 * frictionless ratchet loop's equilibrium position isn't an independent
 * design choice, it's a direct consequence of how much pull strap has been
 * deployed (see computeFloatingAnchor and solveRedirectLoop) — so that's the
 * only thing left for the user to actually control. Picking a corner or tree
 * (or first enabling the feature) auto-solves the *least* tightness that
 * reaches a clean "Good fit" (solveFloatingAnchorTightness) rather than
 * leaving the user to hunt for it by hand or over-tightening past what's
 * actually needed; the slider and "Auto-fit" button let them override or
 * snap back to that suggestion.
 */
export function FloatingAnchor({
  state,
  onChange,
  onAutoFit,
  result,
  redirectTree,
  otherTrees,
  labels,
  ratchetLength,
  unitSystem,
}: Props) {
  if (otherTrees.length === 0) return null

  const totalReach = result ? result.fit[`reach${result.cornerId}` as 'reachA' | 'reachB' | 'reachC'] : 0
  const totalStrap = result ? result.fit[`strap${result.cornerId}` as 'strapA' | 'strapB' | 'strapC'] : 0
  const issues = result ? result.fit.checks.filter((c) => c.status !== 'pass') : []
  const cornerLabel = labels[state.cornerId]

  return (
    <details className="checks-details">
      <summary>4th tree redirect (experimental)</summary>
      <details className="how-it-works-details">
        <summary>How does this work?</summary>
        <p className="hint">
          Only for a corner that doesn't work directly: a spare ratchet loops around that corner's
          own strap and pulls it sideways toward a 4th tree, bending the strap without cutting it
          short.
        </p>
        <Illustration />
      </details>
      <p className="hint">
        Picking a corner and tree below calculates the least tightness that reaches a clean "Good
        fit" — no more pull than that — drag the slider or use Auto-fit to adjust it.
      </p>
      <label className="floating-anchor-toggle">
        <input
          type="checkbox"
          checked={state.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
        />
        Use a floating anchor for one corner
      </label>
      {state.enabled && (
        <div className="field-grid">
          <label>
            Redirect corner
            <select value={state.cornerId} onChange={(e) => onChange({ cornerId: e.target.value as VertexId })}>
              {CORNERS.map((id) => (
                <option key={id} value={id}>
                  {labels[id]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Via tree
            <select
              value={redirectTree?.index ?? ''}
              onChange={(e) => onChange({ redirectIndex: Number(e.target.value) })}
            >
              {otherTrees.map((t) => (
                <option key={t.index} value={t.index}>
                  {t.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            {`Tightness (${state.tightness}%)`}
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={state.tightness}
              onChange={(e) => onChange({ tightness: Number(e.target.value) })}
            />
          </label>
          <div className="auto-fit-field">
            <button type="button" className="small-button" onClick={onAutoFit}>
              Auto-fit
            </button>
          </div>
        </div>
      )}
      {result && (
        <>
          <table className="results-table">
            <tbody>
              <tr>
                <td>{`${cornerLabel} → grab point`}</td>
                <td>{formatLength(result.cornerToGrabReach, unitSystem)}</td>
              </tr>
              <tr>
                <td>{`Grab point → ${cornerLabel} (continuing)`}</td>
                <td>{formatLength(result.grabToTreeReach, unitSystem)}</td>
              </tr>
              <tr>
                <td>{`Total to ${cornerLabel} (bent)`}</td>
                <td>{formatSegment(totalReach, totalStrap, ratchetLength, unitSystem)}</td>
              </tr>
              <tr>
                <td>{`Grab point → ${redirectTree?.display}`}</td>
                <td>{formatSegment(result.redirectReach, result.redirectStrap, ratchetLength, unitSystem)}</td>
              </tr>
              <tr>
                <td>Angle at grab point</td>
                <td>{`${result.redirectAngleDeg.toFixed(0)}°`}</td>
              </tr>
            </tbody>
          </table>
          <p className="hint">
            The other two corners' straps are unaffected by any of this — only {cornerLabel}'s own
            checks below respond to the tightness. Its trunk-diameter check is skipped (a grab
            point has no trunk); its edge-distance and angle checks still treat that end as if it
            had one — there's no real tree there, so read those two with that in mind.
          </p>
          <div className={`verdict verdict-${result.fit.overallVerdict}`}>{VERDICT_COPY[result.fit.overallVerdict]}</div>
          {issues.length > 0 && (
            <ul className="check-list">
              {issues.map((check) => (
                <li key={check.id} className={`check-${check.status}`}>
                  <span className="check-label">{check.label}</span>
                  <span className="check-detail">{check.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </details>
  )
}
