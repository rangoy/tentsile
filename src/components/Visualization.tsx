import * as d3 from 'd3'
import { useRef, type ReactNode } from 'react'
import type { ComboResult, CheckStatus, FitResult, OtherTreePoint, Point, TreeLabels } from '../types'
import { DEFAULT_TRUNK_DIAMETER, signedDistanceToTriangle } from '../geometry'
import { useZoomPan } from '../useZoomPan'
import { ComboTabs } from './ComboTabs'

interface Props {
  fit: FitResult
  diameters: { A: number | null; B: number | null; C: number | null }
  labels: TreeLabels
  otherTrees: OtherTreePoint[]
  combos: ComboResult[]
  selectedKey: string
  onSelectCombo: (key: string) => void
  tailLength: number
}

const WIDTH = 640
const HEIGHT = 480
const PADDING = 56
const MIN_TREE_RADIUS_PX = 7
const MAX_TREE_RADIUS_PX = 22
const TAIL_COLOR = '#e08214'

const STATUS_COLOR: Record<CheckStatus, string> = {
  pass: '#2e8b57',
  tight: '#d98e04',
  fail: '#c0392b',
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
  otherTrees,
  combos,
  selectedKey,
  onSelectCombo,
  tailLength,
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
  const { cornerA, cornerB, cornerC } = fit
  const points = [A, B, C, cornerA, cornerB, cornerC, ...otherTrees.map((t) => t.pos)]

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

  const checkStatus = Object.fromEntries(fit.checks.map((c) => [c.id, c.status])) as Record<
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

  const angleLabels = [
    { id: 'angleA', pos: A, other1: B, other2: C, value: triangle.angleA },
    { id: 'angleB', pos: B, other1: A, other2: C, value: triangle.angleB },
    { id: 'angleC', pos: C, other1: A, other2: B, value: triangle.angleC },
  ]

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

        <path d={tentPath} fill="rgba(80,120,200,0.12)" stroke="#4a68c4" strokeWidth={2} strokeDasharray="6 5" />

        {trees.map((tree) => {
          const centerPx = project(fit.center)
          const cornerPx = project(tree.corner)
          return (
            <line
              key={`radial-${tree.id}`}
              x1={centerPx.x}
              y1={centerPx.y}
              x2={cornerPx.x}
              y2={cornerPx.y}
              stroke="#888"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
          )
        })}

        {(() => {
          const centerPx = project(fit.center)
          return <circle cx={centerPx.x} cy={centerPx.y} r={3} fill="#888" />
        })()}

        {trees.map((tree) => {
          const p1 = project(tree.pos) // tree
          const p2 = project(tree.corner) // tent corner — the tail starts here
          const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
          const strapLength = fit[`strap${tree.id}` as 'strapA' | 'strapB' | 'strapC']
          const ratchetLength = fit[`ratchet${tree.id}` as 'ratchetA' | 'ratchetB' | 'ratchetC']
          const basketLoopNeeded = tailLength > 0 && ratchetLength < 0
          const showTailSegment = tailLength > 0 && !basketLoopNeeded
          const fraction = showTailSegment && strapLength > 0 ? Math.min(tailLength / strapLength, 1) : 0
          const split = { x: p2.x + fraction * (p1.x - p2.x), y: p2.y + fraction * (p1.y - p2.y) }
          const label = basketLoopNeeded
            ? `${strapLength.toFixed(2)} m (basket loop)`
            : tailLength > 0
              ? `${strapLength.toFixed(2)} m (${ratchetLength.toFixed(2)} m)`
              : `${strapLength.toFixed(2)} m`
          const labelWidth = 22 + label.length * 4.6

          return (
            <g key={`strap-${tree.id}`}>
              {showTailSegment && (
                <line x1={p2.x} y1={p2.y} x2={split.x} y2={split.y} stroke={TAIL_COLOR} strokeWidth={2.5} strokeDasharray="2 3" />
              )}
              <line
                x1={showTailSegment ? split.x : p2.x}
                y1={showTailSegment ? split.y : p2.y}
                x2={p1.x}
                y2={p1.y}
                stroke={STATUS_COLOR[checkStatus[tree.strapCheck] ?? 'pass']}
                strokeWidth={2}
                strokeDasharray="2 4"
              />
              <ScreenSpace at={mid} zoomScale={scale}>
                <rect x={-labelWidth / 2} y={-9} width={labelWidth} height={16} fill="white" opacity={0.85} rx={3} />
                <text x={0} y={3} textAnchor="middle" fontSize={11} fill="#333">
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
              fill="#5a3d1e"
              stroke="#2e2010"
              strokeWidth={1}
            />
          )
        })}

        {trees.map((tree) => {
          const p = project(tree.pos)
          return (
            <ScreenSpace at={p} zoomScale={scale} key={`tree-label-${tree.id}`}>
              <text x={0} y={-16} textAnchor="middle" fontSize={13} fontWeight={600}>
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
          return (
            <g key={`other-tree-${tree.display}`} opacity={colliding ? 0.9 : 0.5}>
              <circle
                cx={p.x}
                cy={p.y}
                r={MIN_TREE_RADIUS_PX}
                fill={colliding ? '#c0392b' : '#9c9c94'}
                stroke={colliding ? '#7a2318' : '#6b6b63'}
                strokeWidth={1}
              />
              <ScreenSpace at={p} zoomScale={scale}>
                <text
                  x={0}
                  y={-14}
                  textAnchor="middle"
                  fontSize={12}
                  fontWeight={colliding ? 700 : 400}
                  fill={colliding ? '#c0392b' : '#6b6b63'}
                >
                  {tree.display}
                  {colliding ? ' ⚠' : ''}
                </text>
              </ScreenSpace>
            </g>
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
                fontSize={11}
                fill={STATUS_COLOR[checkStatus[angle.id] ?? 'pass']}
                fontWeight={600}
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
          straps, gray dashed lines = tent center to corner. Orange = the fixed tail between the tent
          corner and the ratchet buckle (only shown once a tail length is set) — the label past it
          shows total reach with the ratchet-only length in parentheses, or "basket loop" if the tree
          is closer than the tail itself. Faint gray dots = other trees in your grove not used by this
          combination; a red dot (⚠) means that tree obstructs the tent footprint. Colors follow the
          checks below (green = pass, amber = tight, red = fail). The closer a strap lines up with its
          gray center line, the tighter/more even the pitch. Scroll/pinch to zoom, drag to pan, or use
          the +/− controls.
        </p>
      </details>
    </div>
  )
}
