import type { FitResult, TreeLabels } from '../types'

interface Props {
  fit: FitResult
  labels: TreeLabels
}

const VERDICT_COPY: Record<FitResult['overallVerdict'], string> = {
  pass: 'Good fit',
  tight: 'Tight fit — workable with adjustment',
  fail: "Won't fit as measured",
}

function formatStrap(meters: number): string {
  return meters < 0 ? '0 m (slack)' : `${meters.toFixed(2)} m`
}

export function ResultsPanel({ fit, labels }: Props) {
  const { triangle } = fit

  return (
    <div className="panel">
      <h2>Result</h2>
      <div className={`verdict verdict-${fit.overallVerdict}`}>{VERDICT_COPY[fit.overallVerdict]}</div>

      {!triangle.valid ? (
        <p className="hint">{triangle.reason}</p>
      ) : (
        <>
          <h3>Strap lengths needed</h3>
          <table className="results-table">
            <tbody>
              <tr>
                <td>{labels.A}</td>
                <td>{formatStrap(fit.strapA)}</td>
              </tr>
              <tr>
                <td>{labels.B}</td>
                <td>{formatStrap(fit.strapB)}</td>
              </tr>
              <tr>
                <td>{labels.C}</td>
                <td>{formatStrap(fit.strapC)}</td>
              </tr>
            </tbody>
          </table>

          <details className="checks-details" open={fit.overallVerdict !== 'pass'}>
            <summary>Checks{issueSummary(fit)}</summary>
            <ul className="check-list">
              {fit.checks.map((check) => (
                <li key={check.id} className={`check-${check.status}`}>
                  <span className="check-label">{check.label}</span>
                  <span className="check-detail">{check.detail}</span>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  )
}

function issueSummary(fit: FitResult): string {
  const issues = fit.checks.filter((c) => c.status !== 'pass').length
  if (issues === 0) return ' — all passed'
  return ` — ${issues} issue${issues === 1 ? '' : 's'}`
}
