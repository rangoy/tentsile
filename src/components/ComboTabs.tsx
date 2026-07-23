import type { ComboResult } from '../types'

interface Props {
  combos: ComboResult[]
  selectedKey: string
  onSelect: (key: string) => void
}

export function comboKey(combo: ComboResult): string {
  return combo.indices.join('-')
}

export function ComboTabs({ combos, selectedKey, onSelect }: Props) {
  if (combos.length === 0) return null

  return (
    <div className="combo-tabs" role="tablist" aria-label="Tree combinations">
      {combos.map((combo) => {
        const key = comboKey(combo)
        const isSelected = key === selectedKey
        const label = combo.indices.map((i) => i + 1).join('/')
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={isSelected}
            title={`${combo.labels.A} · ${combo.labels.B} · ${combo.labels.C}`}
            className={`combo-tab combo-tab-${combo.fit.overallVerdict}${isSelected ? ' combo-tab-selected' : ''}`}
            onClick={() => onSelect(key)}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
