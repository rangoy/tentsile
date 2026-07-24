import type { CheckResult, FitResult, TreeLabels } from '../types'

interface Props {
  fit: FitResult
  labels: TreeLabels
  tailLength: number
}

const BASKET_LOOP_GUIDE_URL = 'https://www.tentsile.com/pages/guides-tips-tricks#closetrees'

function isBasketLoopCheck(check: CheckResult): boolean {
  return check.id.startsWith('tail') && check.status === 'tight'
}

const VERDICT_COPY: Record<FitResult['overallVerdict'], string> = {
  pass: 'Good fit',
  tight: 'Tight fit — workable with adjustment',
  fail: "Won't fit as measured",
}

function formatStrap(strap: number, ratchet: number, tailLength: number): string {
  const main = `${strap.toFixed(2)} m`
  if (tailLength <= 0) return main
  if (ratchet < 0) return `${main} (basket loop)`
  return `${main} (${ratchet.toFixed(2)} m)`
}

export function ResultsPanel({ fit, labels, tailLength }: Props) {
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
          {tailLength > 0 && (
            <p className="hint">Shown as total reach (ratchet strap only, after the tail, in parentheses).</p>
          )}
          <table className="results-table">
            <tbody>
              <tr>
                <td>{labels.A}</td>
                <td>{formatStrap(fit.strapA, fit.ratchetA, tailLength)}</td>
              </tr>
              <tr>
                <td>{labels.B}</td>
                <td>{formatStrap(fit.strapB, fit.ratchetB, tailLength)}</td>
              </tr>
              <tr>
                <td>{labels.C}</td>
                <td>{formatStrap(fit.strapC, fit.ratchetC, tailLength)}</td>
              </tr>
            </tbody>
          </table>

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
