import type { CheckResult, FitResult, TreeLabels } from '../types'
import { LevelCheck } from './LevelCheck'

interface Props {
  fit: FitResult
  labels: TreeLabels
  ratchetLength: number
}

const BASKET_LOOP_GUIDE_URL = 'https://www.tentsile.com/pages/guides-tips-tricks#closetrees'

function isBasketLoopCheck(check: CheckResult): boolean {
  return check.id.startsWith('strap') && check.status === 'tight'
}

const VERDICT_COPY: Record<FitResult['overallVerdict'], string> = {
  pass: 'Good fit',
  tight: 'Tight fit — workable with adjustment',
  fail: "Won't fit as measured",
}

function formatReach(reach: number, strap: number, ratchetLength: number): string {
  const main = `${reach.toFixed(2)} m`
  if (ratchetLength <= 0) return main
  if (strap < 0) return `${main} (basket loop)`
  return `${main} (${strap.toFixed(2)} m)`
}

export function ResultsPanel({ fit, labels, ratchetLength }: Props) {
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
          {ratchetLength > 0 && (
            <p className="hint">Total length (strap without ratchet in parentheses).</p>
          )}
          <table className="results-table">
            <tbody>
              <tr>
                <td>{labels.A}</td>
                <td>{formatReach(fit.reachA, fit.strapA, ratchetLength)}</td>
              </tr>
              <tr>
                <td>{labels.B}</td>
                <td>{formatReach(fit.reachB, fit.strapB, ratchetLength)}</td>
              </tr>
              <tr>
                <td>{labels.C}</td>
                <td>{formatReach(fit.reachC, fit.strapC, ratchetLength)}</td>
              </tr>
            </tbody>
          </table>

          <LevelCheck fit={fit} labels={labels} />

          <details className="checks-details" open={fit.overallVerdict !== 'pass'}>
            <summary>Checks{issueSummary(fit)}</summary>
            <ul className="check-list">
              {fit.checks.map((check) => (
                <li key={check.id} className={`check-${check.status}`}>
                  <span className="check-label">{check.label}</span>
                  <span className="check-detail">
                    {check.detail}
                    {isBasketLoopCheck(check) && (
                      <>
                        {' '}
                        <a href={BASKET_LOOP_GUIDE_URL} target="_blank" rel="noopener noreferrer">
                          Watch how →
                        </a>
                      </>
                    )}
                  </span>
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
