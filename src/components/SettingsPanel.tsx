import type { Settings, UnitSystem } from '../types'
import { TENT_PRESETS } from '../constants'
import { displayLengthToMeters, lengthUnitLabel, metersToDisplayLength } from '../units'
import { NumberInput } from './NumberInput'

interface Props {
  settings: Settings
  onSettingsChange: (settings: Settings) => void
}

export function SettingsPanel({ settings, onSettingsChange }: Props) {
  const unit = settings.unitSystem
  // See InputForm's identical helper — same rounding rationale.
  const toDisplayLen = (meters: number) => Math.round(metersToDisplayLength(meters, unit) * 100) / 100
  const fromDisplayLen = (value: number) => displayLengthToMeters(value, unit)

  return (
    <div className="menu-section">
      <h3>Tent &amp; strap settings</h3>
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
          Non-equal-sided tent: the corner positions in the results are an approximation, not an
          exact fit — and unlike the Stingray, this app's author hasn't personally tested a
          non-equal-sided tent against these numbers. Use the sight-indicator tabs on the sides of
          the real tent/hammock to fine-tune alignment once pitched.
        </p>
      )}
    </div>
  )
}
