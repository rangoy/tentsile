import type { Settings, TreeEntry, TreeReferences } from '../types'
import { CONNECT_BASE, CONNECT_LEG, STINGRAY_SIDE } from '../constants'
import { formatTreeDisplay, MAX_TREES, MIN_TREES } from '../geometry'
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

  const setDiameter = (index: number, raw: string) => {
    const cm = numberOrNull(raw)
    updateTree(index, { diameter: cm === null ? null : cm / 100 })
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
              <th>{`→ ${refALabel} (m)`}</th>
              <th>{`→ ${refBLabel} (m)`}</th>
              <th title={`On the other side of the ${refALabel}-${refBLabel} line`}>Flip</th>
              <th>⌀ (cm)</th>
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
                        value={tree.distToFirst}
                        onChange={(n) => updateTree(index, { distToFirst: n })}
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
                        value={tree.distToSecond}
                        onChange={(n) => updateTree(index, { distToSecond: n })}
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
                      placeholder="40"
                      value={tree.diameter === null ? '' : Math.round(tree.diameter * 100)}
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
      {trees.length >= MAX_TREES && <p className="hint">Up to {MAX_TREES} trees supported.</p>}

      <details className="settings-details">
        <summary>Tent &amp; strap settings</summary>
        <div className="field-grid">
          <label>
            Tent model
            <select
              value={settings.tentModel}
              onChange={(e) => {
                const tentModel = e.target.value as Settings['tentModel']
                const preset =
                  tentModel === 'stingray'
                    ? { tentLegLength: STINGRAY_SIDE, tentBaseLength: STINGRAY_SIDE }
                    : tentModel === 'connect'
                      ? { tentLegLength: CONNECT_LEG, tentBaseLength: CONNECT_BASE }
                      : { tentLegLength: settings.tentLegLength, tentBaseLength: settings.tentBaseLength }
                onSettingsChange({ ...settings, tentModel, ...preset })
              }}
            >
              <option value="stingray">Stingray (4.1 m)</option>
              <option value="connect">Connect (4 / 4 / 2.56 m)</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label>
            Tent leg length (m)
            <NumberInput
              min={0.1}
              step={0.1}
              disabled={settings.tentModel !== 'custom'}
              value={settings.tentLegLength}
              onChange={(n) => onSettingsChange({ ...settings, tentLegLength: n })}
            />
          </label>
          <label>
            Tent base length (m)
            <NumberInput
              min={0.1}
              step={0.1}
              disabled={settings.tentModel !== 'custom'}
              value={settings.tentBaseLength}
              onChange={(n) => onSettingsChange({ ...settings, tentBaseLength: n })}
            />
          </label>
          <label>
            Max strap length (m)
            <NumberInput
              min={0.1}
              step={0.1}
              value={settings.strapMax}
              onChange={(n) => onSettingsChange({ ...settings, strapMax: n })}
            />
          </label>
          <label>
            Ratchet length (m)
            <NumberInput
              min={0}
              step={0.05}
              value={settings.ratchetLength}
              onChange={(n) => onSettingsChange({ ...settings, ratchetLength: n })}
            />
          </label>
        </div>
      </details>
    </div>
  )
}
