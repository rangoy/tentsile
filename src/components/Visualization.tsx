import * as d3 from 'd3'
import type { ComboResult, CheckStatus, FitResult, OtherTreePoint, Point, TreeLabels } from '../types'
import { DEFAULT_TRUNK_DIAMETER, signedDistanceToTriangle } from '../geometry'
import { ComboTabs } from './ComboTabs'

interface Props {
  fit: FitResult
  diameters: { A: number | null; B: number | null; C: number | null }
  labels: TreeLabels
  otherTrees: OtherTreePoint[]
  combos: ComboResult[]
  selectedKey: string
  onSelectCombo: (key: string) => void
}

const WIDTH = 640
const HEIGHT = 480
const PADDING = 56
const MIN_TREE_RADIUS_PX = 7
const MAX_TREE_RADIUS_PX = 22

const STATUS_COLOR: Record<CheckStatus, string> = {
  pass: '#2e8b57',
  tight: '#d98e04',
  fail: '#c0392b',
}

function angleBetween(center: Point, p: Point): number {
  return Math.atan2(p.y - center.y, p.x - center.x)
}

export function Visualization({
  fit,
  diameters,
  labels,
  otherTrees,
  combos,
  selectedKey,
  onSelectCombo,
}: Props) {
  const { triangle } = fit

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
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="viz-svg" role="img" aria-label="Tree and tent layout">
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
          const p1 = project(tree.pos)
          const p2 = project(tree.corner)
          const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
          const strapLength = fit[`strap${tree.id}` as 'strapA' | 'strapB' | 'strapC']
          return (
            <g key={`strap-${tree.id}`}>
              <line
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke={STATUS_COLOR[checkStatus[tree.strapCheck] ?? 'pass']}
                strokeWidth={2}
                strokeDasharray="2 4"
              />
              <rect x={mid.x - 24} y={mid.y - 9} width={48} height={16} fill="white" opacity={0.85} rx={3} />
              <text x={mid.x} y={mid.y + 3} textAnchor="middle" fontSize={11} fill="#333">
                {strapLength < 0 ? '0 m (slack)' : `${strapLength.toFixed(2)} m`}
              </text>
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
            <text key={`tree-label-${tree.id}`} x={p.x} y={p.y - 16} textAnchor="middle" fontSize={13} fontWeight={600}>
              {labels[tree.id]}
            </text>
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
              <text
                x={p.x}
                y={p.y - 14}
                textAnchor="middle"
                fontSize={12}
                fontWeight={colliding ? 700 : 400}
                fill={colliding ? '#c0392b' : '#6b6b63'}
              >
                {tree.display}
                {colliding ? ' ⚠' : ''}
              </text>
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
          const lx = p.x + Math.cos(bisector) * labelOffset
          const ly = p.y - Math.sin(bisector) * labelOffset
          return (
            <text
              key={angle.id}
              x={lx}
              y={ly}
              textAnchor="middle"
              fontSize={11}
              fill={STATUS_COLOR[checkStatus[angle.id] ?? 'pass']}
              fontWeight={600}
            >
              {angle.value.toFixed(0)}°
            </text>
          )
        })}
      </svg>
      <details className="legend-details">
        <summary>Legend</summary>
        <p className="hint">
          Solid triangle = trees in this combination, dashed blue triangle = tent, dotted lines =
          straps, gray dashed lines = tent center to corner. Faint gray dots = other trees in your
          grove not used by this combination; a red dot (⚠) means that tree obstructs the tent
          footprint. Colors follow the checks below (green = pass, amber = tight, red = fail). The
          closer a strap lines up with its gray center line, the tighter/more even the pitch.
        </p>
      </details>
    </div>
  )
}
