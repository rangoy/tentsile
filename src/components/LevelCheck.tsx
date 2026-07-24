import { useState } from 'react'
import { computeLevelAdjustments } from '../geometry'
import { useDeviceTilt } from '../useDeviceTilt'
import type { FitResult, LevelAngles, TreeLabels, VertexId } from '../types'

interface Props {
  fit: FitResult
  labels: TreeLabels
}

const CORNERS: VertexId[] = ['A', 'B', 'C']
const LEVEL_TOLERANCE_CM = 1

function numberOrNull(raw: string): number | null {
  if (raw.trim() === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function formatAdjustment(mountAdjustM: number | null): string {
  if (mountAdjustM === null) return '—'
  const cm = Math.abs(mountAdjustM) * 100
  if (cm < LEVEL_TOLERANCE_CM) return 'Level'
  return mountAdjustM > 0 ? `Raise mount ~${cm.toFixed(0)} cm` : `Lower mount ~${cm.toFixed(0)} cm`
}

export function LevelCheck({ fit, labels }: Props) {
  const [angles, setAngles] = useState<LevelAngles>({ A: null, B: null, C: null })
  const [measuring, setMeasuring] = useState<VertexId | null>(null)
  const { supported, permission, beta, enable } = useDeviceTilt()

  const adjustments = computeLevelAdjustments(fit, angles)

  const startMeasuring = async (corner: VertexId) => {
    if (permission !== 'granted') await enable()
    setMeasuring(corner)
  }

  const captureMeasurement = (corner: VertexId) => {
    if (beta !== null) {
      setAngles((prev) => ({ ...prev, [corner]: Math.round(beta * 10) / 10 }))
    }
    setMeasuring(null)
  }

  return (
    <details className="checks-details">
      <summary>Level check</summary>
      <p className="hint">
        Hold your phone flat against each strap (screen up, top edge toward the tree) and measure
        its tilt, or enter the angle by hand. Corrects for an eyeballed tie-off height: since the
        trees are tied off at roughly the same height by eye, the tilt reveals exactly how far off
        that guess was — the adjustment is how many centimeters to raise or lower each tie-off
        point so the platform ends up level.
      </p>
      {!supported && (
        <p className="hint">Tilt sensor not available on this device/browser — enter angles manually.</p>
      )}
      {permission === 'denied' && <p className="hint">Tilt sensor permission was denied — enter angles manually.</p>}
      <table className="results-table level-check-table">
        <thead>
          <tr>
            <th></th>
            <th>Tilt (°)</th>
            <th aria-hidden="true"></th>
            <th>Adjustment</th>
          </tr>
        </thead>
        <tbody>
          {CORNERS.map((corner) => (
            <tr key={corner}>
              <td>{labels[corner]}</td>
              <td>
                {measuring === corner ? (
                  <strong>{beta === null ? '…' : beta.toFixed(1)}</strong>
                ) : (
                  <input
                    type="number"
                    step={0.5}
                    value={angles[corner] === null ? '' : angles[corner]}
                    onChange={(e) => setAngles((prev) => ({ ...prev, [corner]: numberOrNull(e.target.value) }))}
                  />
                )}
              </td>
              <td>
                {measuring === corner ? (
                  <>
                    <button type="button" className="small-button" onClick={() => captureMeasurement(corner)}>
                      Use
                    </button>{' '}
                    <button type="button" className="small-button" onClick={() => setMeasuring(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  supported &&
                  permission !== 'denied' && (
                    <button
                      type="button"
                      className="small-button"
                      disabled={measuring !== null}
                      onClick={() => startMeasuring(corner)}
                    >
                      Measure
                    </button>
                  )
                )}
              </td>
              <td>{formatAdjustment(adjustments[corner].mountAdjustM)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}
