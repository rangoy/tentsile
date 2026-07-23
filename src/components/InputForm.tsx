import type { Settings, TreeEntry } from '../types'
import { STINGRAY_SIDE } from '../constants'
import { MAX_TREES, MIN_TREES } from '../geometry'

interface Props {
  trees: TreeEntry[]
  onTreesChange: (trees: TreeEntry[]) => void
  settings: Settings
  onSettingsChange: (settings: Settings) => void
  positionErrors: string[]
}

function numberOrNull(raw: string): number | null {
  if (raw.trim() === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export function InputForm({ trees, onTreesChange, settings, onSettingsChange, positionErrors }: Props) {
  const updateTree = (index: number, patch: Partial<TreeEntry>) => {
    onTreesChange(trees.map((t, i) => (i === index ? { ...t, ...patch } : t)))
  }

  const addTree = () => {
    onTreesChange([...trees, { label: '', diameter: null, distToFirst: 6, distToSecond: 6, flipSide: false }])
  }

  const removeTree = (index: number) => {
    onTreesChange(trees.filter((_, i) => i !== index))
  }

  const setDiameter = (index: number, raw: string) => {
    const cm = numberOrNull(raw)
    updateTree(index, { diameter: cm === null ? null : cm / 100 })
  }

  return (
    <div className="panel">
      <h2>Trees</h2>
      <p className="hint">
        Tree 1 &amp; 2 set a baseline. Every tree after that needs its distance to Tree 1 and Tree
        2 — no need to measure every pair.
      </p>

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
              <th>→ T1 (m)</th>
              <th>→ T2 (m)</th>
              <th title="On the other side of the Tree1-Tree2 line">Flip</th>
              <th>⌀ (cm)</th>
              <th aria-hidden="true"></th>
            </tr>
          </thead>
          <tbody>
            {trees.map((tree, index) => (
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
                  {index === 0 ? (
                    <span className="cell-dash">—</span>
                  ) : (
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={tree.distToFirst}
                      onChange={(e) => updateTree(index, { distToFirst: Number(e.target.value) || 0 })}
                    />
                  )}
                </td>
                <td>
                  {index <= 1 ? (
                    <span className="cell-dash">—</span>
                  ) : (
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={tree.distToSecond}
                      onChange={(e) => updateTree(index, { distToSecond: Number(e.target.value) || 0 })}
                    />
                  )}
                </td>
                <td>
                  {index <= 1 ? (
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
                  {index >= 2 && trees.length > MIN_TREES && (
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => removeTree(index)}
                      aria-label={`Remove tree ${index + 1}`}
                    >
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
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
                onSettingsChange({
                  ...settings,
                  tentModel,
                  tentSide: tentModel === 'stingray' ? STINGRAY_SIDE : settings.tentSide,
                })
              }}
            >
              <option value="stingray">Stingray (4.1 m)</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label>
            Tent side length (m)
            <input
              type="number"
              min={0.1}
              step={0.1}
              disabled={settings.tentModel === 'stingray'}
              value={settings.tentSide}
              onChange={(e) => {
                const n = Number(e.target.value)
                onSettingsChange({ ...settings, tentSide: Number.isFinite(n) ? n : settings.tentSide })
              }}
            />
          </label>
          <label>
            Max ratchet strap length (m)
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={settings.strapMax}
              onChange={(e) => {
                const n = Number(e.target.value)
                onSettingsChange({ ...settings, strapMax: Number.isFinite(n) ? n : settings.strapMax })
              }}
            />
          </label>
          <label>
            Tail/tether length (m)
            <input
              type="number"
              min={0}
              step={0.05}
              value={settings.tailLength}
              onChange={(e) => {
                const n = Number(e.target.value)
                onSettingsChange({ ...settings, tailLength: Number.isFinite(n) ? n : settings.tailLength })
              }}
            />
          </label>
        </div>
      </details>
    </div>
  )
}
