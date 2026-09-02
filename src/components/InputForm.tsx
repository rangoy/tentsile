import type { Settings, TreeEntry, TreeReferences, UnitSystem } from '../types'
import { TENT_PRESETS } from '../constants'
import { formatTreeDisplay, MAX_TREES, MIN_TREES, PERFORMANCE_WARNING_TREES } from '../geometry'
import {
  cmToDisplayDiameter,
  diameterUnitLabel,
  displayDiameterToCm,
  displayLengthToMeters,
  lengthUnitLabel,
  metersToDisplayLength,
} from '../units'
import { NumberInput } from './NumberInput'

interface Props {
  trees: TreeEntry[]
  onTreesChange: (trees: TreeEntry[]) => void
  onRemoveTree: (index: number) => void
  references: TreeReferences
  onReferenceChange: (which: 'a' | 'b', newIndex: number) => void
  referenceError: string | null
  settings: Settings
  onSettingsChange: (settings: Settings) => void
  positionErrors: string[]
}

function numberOrNull(raw: string): number | null {
  if (raw.trim() === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function combinationCount(n: number): number {
  return (n * (n - 1) * (n - 2)) / 6
}

export function InputForm({
  trees,
  onTreesChange,
  onRemoveTree,
  references,
  onReferenceChange,
  referenceError,
  settings,
  onSettingsChange,
  positionErrors,
}: Props) {
  const updateTree = (index: number, patch: Partial<TreeEntry>) => {
    onTreesChange(trees.map((t, i) => (i === index ? { ...t, ...patch } : t)))
  }

  const addTree = () => {
    onTreesChange([...trees, { label: '', diameter: null, distToFirst: 6, distToSecond: 6, flipSide: false }])
  }

  const unit = settings.unitSystem
  // Rounded to 2 decimals (~3 mm in imperial) so a metric value that converts to an
  // irrational feet figure doesn't fill the field with float noise — the underlying
  // stored value stays exact; only what's displayed back in the box is rounded.
  const toDisplayLen = (meters: number) => Math.round(metersToDisplayLength(meters, unit) * 100) / 100
  const fromDisplayLen = (value: number) => displayLengthToMeters(value, unit)

  const setDiameter = (index: number, raw: string) => {
    const displayValue = numberOrNull(raw)
    updateTree(index, { diameter: displayValue === null ? null : displayDiameterToCm(displayValue, unit) / 100 })
  }

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
      {referenceError && (
        <ul className="check-list">
          <li className="check-fail">
            <span className="check-detail">{referenceError}</span>
          </li>
        </ul>
      )}

      {positionErrors.length > 0 && (
        <ul className="check-list">
          {positionErrors.map((err) => (
            <li key={err} className="check-fail">
              <span className="check-detail">{err}</span>
            </li>
          ))}
        </ul>
      )}

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
            {trees.map((tree, index) => {
              const isRefA = index === references.a
              const isRefB = index === references.b
              return (
                <tr key={index}>
                  <td className="cell-number">{index + 1}</td>
                  <td>
                    <input
                      className="tree-label-input"
                      type="text"
                      placeholder="optional"
                      value={tree.label}
                      onChange={(e) => updateTree(index, { label: e.target.value })}
                    />
                  </td>
                  <td>
                    {isRefA ? (
                      <span className="cell-dash">—</span>
                    ) : (
                      <NumberInput
                        min={0}
                        step={0.1}
                        value={toDisplayLen(tree.distToFirst)}
                        onChange={(n) => updateTree(index, { distToFirst: fromDisplayLen(n) })}
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
                        value={toDisplayLen(tree.distToSecond)}
                        onChange={(n) => updateTree(index, { distToSecond: fromDisplayLen(n) })}
                      />
                    )}
                  </td>
                  <td>
                    {isRefA || isRefB ? (
                      <span className="cell-dash">—</span>
                    ) : (
                      <input
                        type="checkbox"
                        checked={tree.flipSide}
                        onChange={(e) => updateTree(index, { flipSide: e.target.checked })}
                      />
                    )}
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      placeholder={String(Math.round(cmToDisplayDiameter(40, unit)))}
                      value={tree.diameter === null ? '' : Math.round(cmToDisplayDiameter(tree.diameter * 100, unit))}
                      onChange={(e) => setDiameter(index, e.target.value)}
                    />
                  </td>
                  <td>
                    {!isRefA && !isRefB && trees.length > MIN_TREES && (
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => onRemoveTree(index)}
                        aria-label={`Remove tree ${index + 1}`}
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

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

      <details className="settings-details">
        <summary>Tent &amp; strap settings</summary>
        <div className="field-grid">
          <label>
            Units
            <select
              value={unit}
              onChange={(e) => onSettingsChange({ ...settings, unitSystem: e.target.value as UnitSystem })}
            >
              <option value="metric">Metric (m / cm)</option>
              <option value="imperial">Imperial (ft / in)</option>
            </select>
          </label>
          <label>
            Tent model
            <select
              value={settings.tentModel}
              onChange={(e) => {
                const tentModel = e.target.value as Settings['tentModel']
                if (tentModel === 'custom') {
                  onSettingsChange({ ...settings, tentModel })
                  return
                }
                const preset = TENT_PRESETS[tentModel]
                onSettingsChange({
                  ...settings,
                  tentModel,
                  tentLegLength: preset.legLength,
                  tentBaseLength: preset.baseLength,
                  strapMax: preset.strapMax ?? settings.strapMax,
                })
              }}
            >
              {(Object.keys(TENT_PRESETS) as Array<keyof typeof TENT_PRESETS>).map((model) => (
                <option key={model} value={model}>
                  {TENT_PRESETS[model].label}
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </label>
          <label>
            {`Tent leg length (${lengthUnitLabel(unit)})`}
            <NumberInput
              min={0.1}
              step={0.1}
              disabled={settings.tentModel !== 'custom'}
              value={toDisplayLen(settings.tentLegLength)}
              onChange={(n) => onSettingsChange({ ...settings, tentLegLength: fromDisplayLen(n) })}
            />
          </label>
          <label>
            {`Tent base length (${lengthUnitLabel(unit)})`}
            <NumberInput
              min={0.1}
              step={0.1}
              disabled={settings.tentModel !== 'custom'}
              value={toDisplayLen(settings.tentBaseLength)}
              onChange={(n) => onSettingsChange({ ...settings, tentBaseLength: fromDisplayLen(n) })}
            />
          </label>
          <label>
            {`Max strap length (${lengthUnitLabel(unit)})`}
            <NumberInput
              min={0.1}
              step={0.1}
              value={toDisplayLen(settings.strapMax)}
              onChange={(n) => onSettingsChange({ ...settings, strapMax: fromDisplayLen(n) })}
            />
          </label>
          <label>
            {`Ratchet length (${lengthUnitLabel(unit)})`}
            <NumberInput
              min={0}
              step={0.05}
              value={toDisplayLen(settings.ratchetLength)}
              onChange={(n) => onSettingsChange({ ...settings, ratchetLength: fromDisplayLen(n) })}
            />
          </label>
        </div>
        {settings.tentLegLength !== settings.tentBaseLength && (
          <p className="warning">
            Non-equal-sided tent: the corner positions below are an approximation, not an exact
            fit — and unlike the Stingray, this app's author hasn't personally tested a
            non-equal-sided tent against these numbers. Use the sight-indicator tabs on the sides
            of the real tent/hammock to fine-tune alignment once pitched.
          </p>
        )}
      </details>
    </div>
  )
}
