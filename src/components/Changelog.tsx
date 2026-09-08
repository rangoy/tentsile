import { CHANGELOG } from '../changelog'

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function Changelog() {
  return (
    <div className="menu-section">
      <details className="checks-details">
        <summary>Changelog</summary>
        <ul className="changelog-list">
          {CHANGELOG.map((entry) => (
            <li key={entry.date}>
              <span className="changelog-date">{formatDate(entry.date)}</span>
              <ul>
                {entry.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
