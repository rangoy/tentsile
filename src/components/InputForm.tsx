import { useEffect, useState } from 'react'
import type { Point, Settings, TreeEntry, TreeReferences } from '../types'
import { distance, formatTreeDisplay, MAX_TREES, MIN_TREES, PERFORMANCE_WARNING_TREES, positionFromDistances } from '../geometry'
import {
  cmToDisplayDiameter,
  diameterUnitLabel,
  displayDiameterToCm,
  displayLengthToMeters,
  lengthUnitLabel,
  metersToDisplayLength,
} from '../units'
import { useDebounce } from '../useDebounce'
import { NumberInput } from './NumberInput'

// How long to wait after the last keystroke before committing an edit —
// short enough that it still feels instant on blur/Enter (which flush
// immediately), long enough that a normal typing burst lands as one commit
// instead of one per keystroke (each commit is also one undo step).
const EDIT_DEBOUNCE_MS = 400

interface Props {
  trees: TreeEntry[]
  onTreesChange: (trees: TreeEntry[]) => void
  onRemoveTree: (index: number) => void
  references: TreeReferences
  onReferenceChange: (which: 'a' | 'b', newIndex: number) => void
  settings: Settings
  /** reports which two trees (by index) the currently-focused distance field connects, or null on blur — lets the Visualization highlight that edge — see App.tsx */
  onFocusEdit: (edit: { a: number; b: number } | null) => void
  /** tree index -> warning message, for a row whose last edit was geometrically impossible and got ignored (see App.tsx) */
  invalidTrees: Record<number, string>
  /** reports a row becoming invalid (message) or valid again (null) — see App.tsx's setTreeValidity */
  onTreeValidityChange: (index: number, message: string | null) => void
  /** grove index of the tree currently being dragged on the canvas, or null — highlights the matching row so it's clear which tree that is */
  draggingTreeIndex: number | null
}

function numberOrNull(raw: string): number | null {
  if (raw.trim() === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function combinationCount(n: number): number {
  return (n * (n - 1) * (n - 2)) / 6
}

/**
 * Which side of the refA→refB line a tree sits on — the derived equivalent
 * of the old stored flipSide bit (see positionFromDistances in geometry.ts:
 * the sign of this cross product matches the sign convention it uses).
 */
function isFlippedSide(refA: Point, refB: Point, tree: Point): boolean {
  const cross = (refB.x - refA.x) * (tree.y - refA.y) - (refB.y - refA.y) * (tree.x - refA.x)
  return cross < 0
}

/** Moves `current` to `newDist` from `anchor`, keeping its current bearing — used for a reference tree's own baseline distance, which has no second distance to trilaterate against. */
function withDistanceFromAnchor(anchor: Point, current: Point, newDist: number): Point {
  const dx = current.x - anchor.x
  const dy = current.y - anchor.y
  const currentDist = Math.hypot(dx, dy)
  if (currentDist < 1e-9) return { x: anchor.x + newDist, y: anchor.y }
  const scale = newDist / currentDist
  return { x: anchor.x + dx * scale, y: anchor.y + dy * scale }
}

function invalidTriangleMessage(
  display: string,
  d0: number,
  d1: number,
  baseline: number,
  unitLabel: string,
  refALabel: string,
  refBLabel: string,
): string {
  return `${display}: ${d0} and ${d1} ${unitLabel} don't form a valid triangle with the ${refALabel}-${refBLabel} baseline (${baseline} ${unitLabel}) — left out of the layout until fixed.`
}

function diameterDisplay(diameter: number | null, unit: Settings['unitSystem']): string {
  return diameter === null ? '' : String(Math.round(cmToDisplayDiameter(diameter * 100, unit)))
}

interface TreeRowProps {
  tree: TreeEntry
  index: number
  isRefA: boolean
  isRefB: boolean
  refAPos: Point
  refBPos: Point
  refAIndex: number
  refBIndex: number
  refALabel: string
  refBLabel: string
  unit: Settings['unitSystem']
  isDragging: boolean
  canRemove: boolean
  onUpdateTree: (index: number, patch: Partial<TreeEntry>) => void
  onRemoveTree: (index: number) => void
  onFocusEdit: (edit: { a: number; b: number } | null) => void
  onTreeValidityChange: (index: number, message: string | null) => void
}

/**
 * One editable row. Pulled out of InputForm's table map (rather than inlined
 * there) so each field can hold its own local "what's displayed right now"
 * text state — needed for the debounced fields below: the input must keep
 * showing every keystroke immediately even while the actual commit upstream
 * (which recomputes the whole grove) is still waiting out the debounce.
 */
function TreeRow({
  tree,
  index,
  isRefA,
  isRefB,
  refAPos,
  refBPos,
  refAIndex,
  refBIndex,
  refALabel,
  refBLabel,
  unit,
  isDragging,
  canRemove,
  onUpdateTree,
  onRemoveTree,
  onFocusEdit,
  onTreeValidityChange,
}: TreeRowProps) {
  const distToA = distance(tree, refAPos)
  const distToB = distance(tree, refBPos)
  const flipSide = isFlippedSide(refAPos, refBPos, tree)
  const unitLabel = lengthUnitLabel(unit)
  // Rounded to 2 decimals (~3 mm in imperial) so a metric value that converts to an
  // irrational feet figure doesn't fill the field with float noise — the underlying
  // stored value stays exact; only what's displayed back in the box is rounded.
  const toDisplayLen = (meters: number) => Math.round(metersToDisplayLength(meters, unit) * 100) / 100
  const fromDisplayLen = (value: number) => displayLengthToMeters(value, unit)

  const rejectEdit = (d0: number, d1: number) => {
    onTreeValidityChange(
      index,
      invalidTriangleMessage(
        formatTreeDisplay(index + 1, tree.label),
        toDisplayLen(d0),
        toDisplayLen(d1),
        toDisplayLen(distance(refAPos, refBPos)),
        unitLabel,
        refALabel,
        refBLabel,
      ),
    )
  }
  const applyEdit = (pos: Point) => {
    onUpdateTree(index, { x: pos.x, y: pos.y })
    onTreeValidityChange(index, null)
  }

  const [labelText, setLabelText] = useState(tree.label)
  useEffect(() => setLabelText(tree.label), [tree.label])
  const labelDebounce = useDebounce(EDIT_DEBOUNCE_MS)

  const [diameterText, setDiameterText] = useState(() => diameterDisplay(tree.diameter, unit))
  useEffect(() => setDiameterText(diameterDisplay(tree.diameter, unit)), [tree.diameter, unit])
  const diameterDebounce = useDebounce(EDIT_DEBOUNCE_MS)
  const commitDiameter = (raw: string) => {
    const displayValue = numberOrNull(raw)
    onUpdateTree(index, { diameter: displayValue === null ? null : displayDiameterToCm(displayValue, unit) / 100 })
  }

  const distADebounce = useDebounce(EDIT_DEBOUNCE_MS)
  const distBDebounce = useDebounce(EDIT_DEBOUNCE_MS)

  return (
    <tr className={isDragging ? 'tree-row-dragging' : undefined}>
      <td className="cell-number">{index + 1}</td>
      <td>
        <input
          className="tree-label-input"
          type="text"
          placeholder="optional"
          value={labelText}
          onChange={(e) => {
            const next = e.target.value
            setLabelText(next)
            labelDebounce.schedule(() => onUpdateTree(index, { label: next }))
          }}
          onBlur={labelDebounce.flush}
        />
      </td>
      <td>
        {isRefA ? (
          <span className="cell-dash">—</span>
        ) : (
          <NumberInput
            min={0}
            step={0.1}
            value={toDisplayLen(distToA)}
            onChange={(n) =>
              distADebounce.schedule(() => {
                const newDist = fromDisplayLen(n)
                const pos = isRefB
                  ? withDistanceFromAnchor(refAPos, tree, newDist)
                  : positionFromDistances(refAPos, refBPos, newDist, distToB, flipSide)
                if (pos) applyEdit(pos)
                else rejectEdit(newDist, distToB)
              })
            }
            onFocus={() => onFocusEdit({ a: refAIndex, b: index })}
            onBlur={() => {
              distADebounce.flush()
              onFocusEdit(null)
            }}
          />
        )}
      </td>
      <td>
        {isRefA || isRefB ? (
          <span className="cell-dash">—</span>
        ) : (
          <NumberInput
            min={0}
            step={0.1}
            value={toDisplayLen(distToB)}
            onChange={(n) =>
              distBDebounce.schedule(() => {
                const newDist = fromDisplayLen(n)
                const pos = positionFromDistances(refAPos, refBPos, distToA, newDist, flipSide)
                if (pos) applyEdit(pos)
                else rejectEdit(distToA, newDist)
              })
            }
            onFocus={() => onFocusEdit({ a: refBIndex, b: index })}
            onBlur={() => {
              distBDebounce.flush()
              onFocusEdit(null)
            }}
          />
        )}
      </td>
      <td>
        {isRefA || isRefB ? (
          <span className="cell-dash">—</span>
        ) : (
          <input
            type="checkbox"
            checked={flipSide}
            onChange={(e) => {
              const pos = positionFromDistances(refAPos, refBPos, distToA, distToB, e.target.checked)
              if (pos) applyEdit(pos)
            }}
          />
        )}
      </td>
      <td>
        <input
          type="number"
          min={0}
          step={1}
          placeholder={String(Math.round(cmToDisplayDiameter(40, unit)))}
          value={diameterText}
          onChange={(e) => {
            const next = e.target.value
            setDiameterText(next)
            diameterDebounce.schedule(() => commitDiameter(next))
          }}
          onBlur={diameterDebounce.flush}
        />
      </td>
      <td>
        {!isRefA && !isRefB && canRemove && (
          <button type="button" className="icon-button" onClick={() => onRemoveTree(index)} aria-label={`Remove tree ${index + 1}`}>
            ×
          </button>
        )}
      </td>
    </tr>
  )
}

export function InputForm({
  trees,
  onTreesChange,
  onRemoveTree,
  references,
  onReferenceChange,
  settings,
  onFocusEdit,
  invalidTrees,
  onTreeValidityChange,
  draggingTreeIndex,
}: Props) {
  const updateTree = (index: number, patch: Partial<TreeEntry>) => {
    onTreesChange(trees.map((t, i) => (i === index ? { ...t, ...patch } : t)))
  }

  const refAPos: Point = trees[references.a] ?? { x: 0, y: 0 }
  const refBPos: Point = trees[references.b] ?? { x: 0, y: 0 }

  const addTree = () => {
    const pos = positionFromDistances(refAPos, refBPos, 6, 6, false) ?? { x: refAPos.x + 6, y: refAPos.y }
    onTreesChange([...trees, { label: '', diameter: null, x: pos.x, y: pos.y }])
  }

  const unit = settings.unitSystem

  const refALabel = formatTreeDisplay(references.a + 1, trees[references.a]?.label ?? '')
  const refBLabel = formatTreeDisplay(references.b + 1, trees[references.b]?.label ?? '')

  return (
    <div className="panel">
      <h2>Trees</h2>
      <p className="hint">
        {refALabel} &amp; {refBLabel} are the reference trees — every other tree needs its distance
        to both. Hard to measure between those two? Pick a different pair below.
      </p>

      <div className="field-grid reference-picker">
        <label>
          Reference A
          <select value={references.a} onChange={(e) => onReferenceChange('a', Number(e.target.value))}>
            {trees.map((tree, i) =>
              i === references.b ? null : (
                <option key={i} value={i}>
                  {formatTreeDisplay(i + 1, tree.label)}
                </option>
              ),
            )}
          </select>
        </label>
        <label>
          Reference B
          <select value={references.b} onChange={(e) => onReferenceChange('b', Number(e.target.value))}>
            {trees.map((tree, i) =>
              i === references.a ? null : (
                <option key={i} value={i}>
                  {formatTreeDisplay(i + 1, tree.label)}
                </option>
              ),
            )}
          </select>
        </label>
      </div>

      <div className="tree-table-wrap">
        <table className="tree-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Label</th>
              <th>{`→ ${refALabel} (${lengthUnitLabel(unit)})`}</th>
              <th>{`→ ${refBLabel} (${lengthUnitLabel(unit)})`}</th>
              <th title={`On the other side of the ${refALabel}-${refBLabel} line`}>Flip</th>
              <th>{`⌀ (${diameterUnitLabel(unit)})`}</th>
              <th aria-hidden="true"></th>
            </tr>
          </thead>
          <tbody>
            {trees.map((tree, index) => (
              <TreeRow
                key={index}
                tree={tree}
                index={index}
                isRefA={index === references.a}
                isRefB={index === references.b}
                refAPos={refAPos}
                refBPos={refBPos}
                refAIndex={references.a}
                refBIndex={references.b}
                refALabel={refALabel}
                refBLabel={refBLabel}
                unit={unit}
                isDragging={index === draggingTreeIndex}
                canRemove={trees.length > MIN_TREES}
                onUpdateTree={updateTree}
                onRemoveTree={onRemoveTree}
                onFocusEdit={onFocusEdit}
                onTreeValidityChange={onTreeValidityChange}
              />
            ))}
          </tbody>
        </table>
      </div>

      {Object.keys(invalidTrees).length > 0 && (
        <ul className="check-list">
          {Object.entries(invalidTrees).map(([index, message]) => (
            <li key={index} className="check-fail">
              <span className="check-detail">{message}</span>
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="add-tree-button" onClick={addTree} disabled={trees.length >= MAX_TREES}>
        + Add another tree
      </button>
      {trees.length >= MAX_TREES ? (
        <p className="hint">Up to {MAX_TREES} trees supported.</p>
      ) : (
        trees.length > PERFORMANCE_WARNING_TREES && (
          <p className="hint">
            {trees.length} trees means checking {combinationCount(trees.length)} 3-tree combinations
            on every edit — things may start to feel slow.
          </p>
        )
      )}
    </div>
  )
}
