import * as d3 from 'd3'
import { useRef, type ReactNode } from 'react'
import type {
  ComboResult,
  CheckStatus,
  FitResult,
  FloatingAnchorResult,
  OtherTreePoint,
  Point,
  TreeLabels,
  UnitSystem,
} from '../types'
import { DEFAULT_TRUNK_DIAMETER, signedDistanceToTriangle } from '../geometry'
import { formatLength } from '../units'
import { useZoomPan } from '../useZoomPan'
import { ComboTabs } from './ComboTabs'

interface Props {
  fit: FitResult
  diameters: { A: number | null; B: number | null; C: number | null }
  labels: TreeLabels
  /** indices into the trees array for the currently selected combo's A/B/C — lets focusedEdit resolve either a combo tree or an otherTrees tree to a position */
  comboIndices: readonly [number, number, number]
  otherTrees: OtherTreePoint[]
  combos: ComboResult[]
  selectedKey: string
  onSelectCombo: (key: string) => void
  ratchetLength: number
  unitSystem: UnitSystem
  /** when set, the redirected corner draws as two segments (to the grab point, then to the redirect tree) instead of one straight strap — see FloatingAnchor.tsx */
  floatingAnchor?: { result: FloatingAnchorResult; redirectTree: OtherTreePoint } | null
  /** the two trees (by index into the trees array) behind whichever distance field is currently focused in the input table, or null when nothing's focused — see InputForm */
  focusedEdit?: { a: number; b: number } | null
}

const WIDTH = 640
const HEIGHT = 480
const PADDING = 56
const MIN_TREE_RADIUS_PX = 7
const MAX_TREE_RADIUS_PX = 22
const RATCHET_COLOR = 'var(--viz-ratchet)'
const REDIRECT_COLOR = 'var(--viz-redirect)'
const HIGHLIGHT_COLOR = 'var(--viz-highlight)'

const STATUS_COLOR: Record<CheckStatus, string> = {
  pass: 'var(--viz-status-pass)',
  tight: 'var(--viz-status-tight)',
  fail: 'var(--viz-status-fail)',
}

function angleBetween(center: Point, p: Point): number {
  return Math.atan2(p.y - center.y, p.x - center.x)
}

/**
 * Anchors children at `at` (in the same pre-zoom coordinate space as the rest
 * of the diagram) but counter-scales by 1/zoomScale, so labels keep a
 * constant apparent size — and stay legible/uncluttered — while the
 * surrounding geometry (trees, straps, tent) scales normally with zoom.
 * Children should be positioned relative to (0, 0), not `at`.
 */
function ScreenSpace({ at, zoomScale, children }: { at: Point; zoomScale: number; children: ReactNode }) {
  return <g transform={`translate(${at.x} ${at.y}) scale(${1 / zoomScale})`}>{children}</g>
}

export function Visualization({
  fit,
  diameters,
  labels,
  comboIndices,
  otherTrees,
  combos,
  selectedKey,
  onSelectCombo,
  ratchetLength,
  unitSystem,
  floatingAnchor,
  focusedEdit,
}: Props) {
  const { triangle } = fit
  const svgRef = useRef<SVGSVGElement>(null)
  const { transform, scale, handlers, zoomIn, zoomOut, reset, isDefault } = useZoomPan(svgRef, selectedKey)

  if (!triangle.valid) {
    return (
      <div className="panel">
        <ComboTabs combos={combos} selectedKey={selectedKey} onSelect={onSelectCombo} />
        <h2>Layout</h2>
        <p className="hint">Enter three valid distances to see the layout.</p>
      </div>
    )
  }

  const { A, B, C } = triangle
  // The tent's own placement (corners/center) reflects the floating-anchor fit when one's
  // active — a different, real recomputation (see computeFloatingAnchor), not just an
  // overlay on top of the un-redirected fit. The 3 real trees (A/B/C) never move either way.
  const activeFit = floatingAnchor?.result.fit.triangle.valid ? floatingAnchor.result.fit : fit
  const { cornerA, cornerB, cornerC } = activeFit
  const points = [
    A,
    B,
    C,
    cornerA,
    cornerB,
    cornerC,
    ...otherTrees.map((t) => t.pos),
    ...(floatingAnchor ? [floatingAnchor.result.virtualPoint] : []),
  ]

  const xExtent = d3.extent(points, (p) => p.x) as [number, number]
  const yExtent = d3.extent(points, (p) => p.y) as [number, number]
  const spanX = xExtent[1] - xExtent[0] || 1
  const spanY = yExtent[1] - yExtent[0] || 1
  const k = Math.min((WIDTH - 2 * PADDING) / spanX, (HEIGHT - 2 * PADDING) / spanY)
  const cx = (xExtent[0] + xExtent[1]) / 2
  const cy = (yExtent[0] + yExtent[1]) / 2

  const xScale = d3
    .scaleLinear()
    .domain([cx - WIDTH / 2 / k, cx + WIDTH / 2 / k])
    .range([0, WIDTH])
  const yScale = d3
    .scaleLinear()
    .domain([cy - HEIGHT / 2 / k, cy + HEIGHT / 2 / k])
    .range([HEIGHT, 0])

  const project = (p: Point) => ({ x: xScale(p.x), y: yScale(p.y) })

  const lineGen = d3
    .line<Point>()
    .x((p) => project(p).x)
    .y((p) => project(p).y)
    .curve(d3.curveLinearClosed)

  const tentPath = lineGen([cornerA, cornerB, cornerC]) ?? ''

  const checkStatus = Object.fromEntries(activeFit.checks.map((c) => [c.id, c.status])) as Record<
    string,
    CheckStatus
  >

  const trees = [
    {
      id: 'A',
      pos: A,
      corner: cornerA,
      diameter: diameters.A ?? DEFAULT_TRUNK_DIAMETER,
      edgeCheck: 'edgeAB',
      strapCheck: 'strapA',
    },
    {
      id: 'B',
      pos: B,
      corner: cornerB,
      diameter: diameters.B ?? DEFAULT_TRUNK_DIAMETER,
      edgeCheck: 'edgeBC',
      strapCheck: 'strapB',
    },
    {
      id: 'C',
      pos: C,
      corner: cornerC,
      diameter: diameters.C ?? DEFAULT_TRUNK_DIAMETER,
      edgeCheck: 'edgeCA',
      strapCheck: 'strapC',
    },
  ] as const

  const edges: Array<{ id: string; from: Point; to: Point }> = [
    { id: 'edgeAB', from: A, to: B },
    { id: 'edgeBC', from: B, to: C },
    { id: 'edgeCA', from: C, to: A },
  ]

  // Values come from activeFit (the floating-anchor fit when one's active, matching the
  // checks/colors already shown elsewhere), but the label always anchors at the real tree
  // position — for the redirected corner specifically, that's "the angle at the grab point,"
  // shown at the real tree it's no longer tied to (see FloatingAnchor.tsx's own caveat).
  const angleLabels = [
    { id: 'angleA', pos: A, other1: B, other2: C, value: activeFit.triangle.angleA },
    { id: 'angleB', pos: B, other1: A, other2: C, value: activeFit.triangle.angleB },
    { id: 'angleC', pos: C, other1: A, other2: B, value: activeFit.triangle.angleC },
  ]

  // Resolves any tree in the grove (by index into the trees array) to its
  // real position in this diagram's frame — either one of the 3 selected
  // combo trees (A/B/C) or one of the projected otherTrees dots. Used only by
  // the focused-edit highlight below, which can point at either kind.
  const indexToPoint = (index: number): Point | null => {
    const comboSlot = comboIndices.indexOf(index)
    if (comboSlot === 0) return A
    if (comboSlot === 1) return B
    if (comboSlot === 2) return C
    return otherTrees.find((t) => t.index === index)?.pos ?? null
  }

  const focusedPoints = focusedEdit
    ? ([indexToPoint(focusedEdit.a), indexToPoint(focusedEdit.b)] as const)
    : null

  return (
    <div className="panel">
      <ComboTabs combos={combos} selectedKey={selectedKey} onSelect={onSelectCombo} />
      <h2>Layout</h2>
      <div className="viz-canvas">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="viz-svg"
          role="img"
          aria-label="Tree and tent layout — scroll or pinch to zoom, drag to pan"
          {...handlers}
        >
          <g transform={transform}>
        {edges.map((edge) => {
          const p1 = project(edge.from)
          const p2 = project(edge.to)
          return (
            <line
              key={edge.id}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke={STATUS_COLOR[checkStatus[edge.id] ?? 'pass']}
              strokeWidth={2}
            />
          )
        })}

        <path d={tentPath} fill="var(--viz-tent-fill)" stroke="var(--viz-tent-stroke)" strokeWidth={2} strokeDasharray="6 5" />

        {focusedPoints && focusedPoints[0] && focusedPoints[1] && (() => {
          const p1 = project(focusedPoints[0])
          const p2 = project(focusedPoints[1])
          return (
            <line
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke={HIGHLIGHT_COLOR}
              strokeWidth={4}
              strokeLinecap="round"
              opacity={0.85}
            />
          )
        })()}

        {trees.map((tree) => {
          const centerPx = project(activeFit.center)
          const cornerPx = project(tree.corner)
          return (
            <line
              key={`radial-${tree.id}`}
              x1={centerPx.x}
              y1={centerPx.y}
              x2={cornerPx.x}
              y2={cornerPx.y}
              stroke="var(--viz-spoke)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
          )
        })}

        {(() => {
          const centerPx = project(activeFit.center)
          return <circle cx={centerPx.x} cy={centerPx.y} r={3} fill="var(--viz-spoke)" />
        })()}

        {trees.map((tree) => {
          const isRedirected = tree.id === floatingAnchor?.result.cornerId

          // A redirected corner's strap doesn't run straight to the real tree — it bends at
          // the grab point, then continues on to the real tree past it (see
          // computeFloatingAnchor), plus a third, separate pull strap from the grab point to
          // the 4th tree. A normal corner just draws the one straight segment as before.
          if (isRedirected && floatingAnchor) {
            const { result, redirectTree } = floatingAnchor
            const cornerPx = project(tree.corner)
            const grabPx = project(result.virtualPoint)
            const treePx = project(tree.pos)
            const redirectPx = project(redirectTree.pos)

            const ratchetFraction =
              ratchetLength > 0 && result.cornerToGrabReach > 0 ? Math.min(ratchetLength / result.cornerToGrabReach, 1) : 0
            const split = {
              x: cornerPx.x + ratchetFraction * (grabPx.x - cornerPx.x),
              y: cornerPx.y + ratchetFraction * (grabPx.y - cornerPx.y),
            }
            const showRatchetSegment = ratchetLength > 0 && ratchetFraction < 1

            const segments: Array<{ key: string; from: Point; to: Point; label: string; color: string }> = [
              {
                key: 'continue',
                from: grabPx,
                to: treePx,
                label: `${formatLength(result.grabToTreeReach, unitSystem)}`,
                color: REDIRECT_COLOR,
              },
              {
                key: 'pull',
                from: grabPx,
                to: redirectPx,
                label:
                  result.redirectStrap < 0 && ratchetLength > 0
                    ? `${formatLength(result.redirectReach, unitSystem)} (basket loop)`
                    : ratchetLength > 0
                      ? `${formatLength(result.redirectReach, unitSystem)} (${formatLength(result.redirectStrap, unitSystem)})`
                      : formatLength(result.redirectReach, unitSystem),
                color: REDIRECT_COLOR,
              },
            ]

            return (
              <g key={`strap-${tree.id}`}>
                {showRatchetSegment && (
                  <line x1={cornerPx.x} y1={cornerPx.y} x2={split.x} y2={split.y} stroke={RATCHET_COLOR} strokeWidth={2.5} strokeDasharray="2 3" />
                )}
                <line
                  x1={showRatchetSegment ? split.x : cornerPx.x}
                  y1={showRatchetSegment ? split.y : cornerPx.y}
                  x2={grabPx.x}
                  y2={grabPx.y}
                  stroke={REDIRECT_COLOR}
                  strokeWidth={2}
                  strokeDasharray="2 4"
                />
                <ScreenSpace at={{ x: (cornerPx.x + grabPx.x) / 2, y: (cornerPx.y + grabPx.y) / 2 }} zoomScale={scale}>
                  {(() => {
                    const label = formatLength(result.cornerToGrabReach, unitSystem)
                    const labelWidth = 24 + label.length * 5.4
                    return (
                      <>
                        <rect x={-labelWidth / 2} y={-10} width={labelWidth} height={19} fill="var(--viz-bg)" opacity={0.85} rx={3} />
                        <text x={0} y={4} textAnchor="middle" fontSize={13} fill="var(--viz-ink)">
                          {label}
                        </text>
                      </>
                    )
                  })()}
                </ScreenSpace>
                <circle cx={grabPx.x} cy={grabPx.y} r={5} fill="var(--viz-bg)" stroke={REDIRECT_COLOR} strokeWidth={2.5} />
                {segments.map((seg) => {
                  const mid = { x: (seg.from.x + seg.to.x) / 2, y: (seg.from.y + seg.to.y) / 2 }
                  const labelWidth = 24 + seg.label.length * 5.4
                  return (
                    <g key={seg.key}>
                      <line x1={seg.from.x} y1={seg.from.y} x2={seg.to.x} y2={seg.to.y} stroke={seg.color} strokeWidth={2} strokeDasharray="1 4" />
                      <ScreenSpace at={mid} zoomScale={scale}>
                        <rect x={-labelWidth / 2} y={-10} width={labelWidth} height={19} fill="var(--viz-bg)" opacity={0.85} rx={3} />
                        <text x={0} y={4} textAnchor="middle" fontSize={13} fill={seg.color}>
                          {seg.label}
                        </text>
                      </ScreenSpace>
                    </g>
                  )
                })}
              </g>
            )
          }

          const p1 = project(tree.pos)
          const p2 = project(tree.corner) // tent corner — the ratchet starts here
          const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
          const reachLength = activeFit[`reach${tree.id}` as 'reachA' | 'reachB' | 'reachC']
          const strapLength = activeFit[`strap${tree.id}` as 'strapA' | 'strapB' | 'strapC']
          const basketLoopNeeded = ratchetLength > 0 && strapLength < 0
          const showRatchetSegment = ratchetLength > 0 && !basketLoopNeeded
          const fraction = showRatchetSegment && reachLength > 0 ? Math.min(ratchetLength / reachLength, 1) : 0
          const split = { x: p2.x + fraction * (p1.x - p2.x), y: p2.y + fraction * (p1.y - p2.y) }
          const label = basketLoopNeeded
            ? `${formatLength(reachLength, unitSystem)} (basket loop)`
            : ratchetLength > 0
              ? `${formatLength(reachLength, unitSystem)} (${formatLength(strapLength, unitSystem)})`
              : formatLength(reachLength, unitSystem)
          const labelWidth = 24 + label.length * 5.4

          return (
            <g key={`strap-${tree.id}`}>
              {showRatchetSegment && (
                <line x1={p2.x} y1={p2.y} x2={split.x} y2={split.y} stroke={RATCHET_COLOR} strokeWidth={2.5} strokeDasharray="2 3" />
              )}
              <line
                x1={showRatchetSegment ? split.x : p2.x}
                y1={showRatchetSegment ? split.y : p2.y}
                x2={p1.x}
                y2={p1.y}
                stroke={STATUS_COLOR[checkStatus[tree.strapCheck] ?? 'pass']}
                strokeWidth={2}
                strokeDasharray="2 4"
              />
              <ScreenSpace at={mid} zoomScale={scale}>
                <rect x={-labelWidth / 2} y={-10} width={labelWidth} height={19} fill="var(--viz-bg)" opacity={0.85} rx={3} />
                <text x={0} y={4} textAnchor="middle" fontSize={13} fill="var(--viz-ink)">
                  {label}
                </text>
              </ScreenSpace>
            </g>
          )
        })}

        {trees.map((tree) => {
          const p = project(tree.pos)
          const radiusPx = Math.min(
            MAX_TREE_RADIUS_PX,
            Math.max(MIN_TREE_RADIUS_PX, ((tree.diameter / 2) * k) as number),
          )
          return (
            <circle
              key={`tree-${tree.id}`}
              cx={p.x}
              cy={p.y}
              r={radiusPx}
              fill="var(--viz-trunk)"
              stroke="var(--viz-bg)"
              strokeWidth={2}
            />
          )
        })}

        {trees.map((tree) => {
          const p = project(tree.pos)
          return (
            <ScreenSpace at={p} zoomScale={scale} key={`tree-label-${tree.id}`}>
              <text
                x={0}
                y={-16}
                textAnchor="middle"
                fontSize={15}
                fontWeight={600}
                fill="var(--viz-ink)"
                stroke="var(--viz-bg)"
                strokeWidth={3}
                strokeLinejoin="round"
                paintOrder="stroke"
              >
                {labels[tree.id]}
              </text>
            </ScreenSpace>
          )
        })}

        {otherTrees.map((tree) => {
          const p = project(tree.pos)
          const trunkRadius = (tree.diameter ?? DEFAULT_TRUNK_DIAMETER) / 2
          const clearance = signedDistanceToTriangle(tree.pos, cornerA, cornerB, cornerC) - trunkRadius
          const colliding = clearance < 0
          const isRedirectTree = tree.index === floatingAnchor?.redirectTree.index
          return (
            <g key={`other-tree-${tree.display}`} opacity={colliding || isRedirectTree ? 0.9 : 0.5}>
              {isRedirectTree && (
                <circle cx={p.x} cy={p.y} r={MIN_TREE_RADIUS_PX + 4} fill="none" stroke={REDIRECT_COLOR} strokeWidth={2} />
              )}
              <circle
                cx={p.x}
                cy={p.y}
                r={MIN_TREE_RADIUS_PX}
                fill={colliding ? 'var(--viz-status-fail)' : 'var(--viz-other-tree)'}
                stroke="var(--viz-bg)"
                strokeWidth={1.5}
              />
              <ScreenSpace at={p} zoomScale={scale}>
                <text
                  x={0}
                  y={-14}
                  textAnchor="middle"
                  fontSize={13}
                  fontWeight={colliding || isRedirectTree ? 700 : 400}
                  fill={colliding ? 'var(--viz-status-fail)' : isRedirectTree ? REDIRECT_COLOR : 'var(--viz-other-tree)'}
                  stroke="var(--viz-bg)"
                  strokeWidth={3}
                  strokeLinejoin="round"
                  paintOrder="stroke"
                >
                  {tree.display}
                  {colliding ? ' ⚠' : ''}
                </text>
              </ScreenSpace>
            </g>
          )
        })}

        {focusedEdit &&
          [focusedEdit.a, focusedEdit.b].map((idx) => {
            const pos = indexToPoint(idx)
            if (!pos) return null
            const p = project(pos)
            return (
              <circle
                key={`focus-ring-${idx}`}
                cx={p.x}
                cy={p.y}
                r={MAX_TREE_RADIUS_PX + 6}
                fill="none"
                stroke={HIGHLIGHT_COLOR}
                strokeWidth={3}
              />
            )
          })}

        {angleLabels.map((angle) => {
          const p = project(angle.pos)
          const a1 = angleBetween(angle.pos, angle.other1)
          const a2 = angleBetween(angle.pos, angle.other2)
          // bisector direction in world space, projected screen-side offset
          let bisector = (a1 + a2) / 2
          if (Math.cos(a1 - bisector) < 0) bisector += Math.PI
          const labelOffset = 26
          const lx = Math.cos(bisector) * labelOffset
          const ly = -Math.sin(bisector) * labelOffset
          return (
            <ScreenSpace at={p} zoomScale={scale} key={angle.id}>
              <text
                x={lx}
                y={ly}
                textAnchor="middle"
                fontSize={13}
                fill={STATUS_COLOR[checkStatus[angle.id] ?? 'pass']}
                fontWeight={600}
                stroke="var(--viz-bg)"
                strokeWidth={3}
                strokeLinejoin="round"
                paintOrder="stroke"
              >
                {angle.value.toFixed(0)}°
              </text>
            </ScreenSpace>
          )
        })}
          </g>
        </svg>
        <div className="viz-controls">
          <button type="button" onClick={zoomOut} aria-label="Zoom out">
            −
          </button>
          {!isDefault && (
            <button type="button" onClick={reset} aria-label="Reset view" className="viz-reset-button">
              Reset
            </button>
          )}
          <button type="button" onClick={zoomIn} aria-label="Zoom in">
            +
          </button>
        </div>
      </div>
      <details className="legend-details">
        <summary>Legend</summary>
        <p className="hint">
          Solid triangle = trees in this combination, dashed blue triangle = tent, dotted lines =
          straps, gray dashed lines = tent center to corner. Orange = the fixed ratchet between the
          tent corner and the strap (only shown once a ratchet length is set) — the label past it
          shows total reach with the strap-only length in parentheses, or "basket loop" if the tree
          is closer than the ratchet itself. Faint gray dots = other trees in your grove not used by this
          combination; a red dot (⚠) means that tree obstructs the tent footprint. Colors follow the
          checks below (green = pass, amber = tight, red = fail). The closer a strap lines up with its
          gray center line, the tighter/more even the pitch. Purple = a 4th tree redirect (see "4th
          tree redirect" below the results, if enabled) — a purple ring marks the redirect tree, a
          purple circle marks the grab point, and the dotted purple line is the second strap segment
          between them; the tent shown reflects that redirected placement while it's active. Pink =
          the distance and the two trees for whichever field is focused in the tree table below.
          Scroll/pinch to zoom, drag to pan, or use the +/− controls.
        </p>
      </details>
    </div>
  )
}
