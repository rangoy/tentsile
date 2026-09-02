import type { UnitSystem } from './types'

const METERS_PER_FOOT = 0.3048
const CM_PER_INCH = 2.54

/**
 * Display/input-boundary conversion only — every stored value (Settings,
 * TreeEntry, and everything geometry.ts computes) stays in meters regardless
 * of this setting. Only the number shown in a field, and the number read
 * back out of it, are converted. Descriptive check messages (`CheckResult.detail`)
 * are generated in geometry.ts before any unit is chosen and stay in metric —
 * converting those would mean threading a display concern into the pure
 * geometry layer, so this app's numeric fields (inputs and headline results)
 * go imperial, but check explanations stay in meters/cm either way.
 */

export function metersToDisplayLength(meters: number, unit: UnitSystem): number {
  return unit === 'imperial' ? meters / METERS_PER_FOOT : meters
}

export function displayLengthToMeters(value: number, unit: UnitSystem): number {
  return unit === 'imperial' ? value * METERS_PER_FOOT : value
}

export function lengthUnitLabel(unit: UnitSystem): string {
  return unit === 'imperial' ? 'ft' : 'm'
}

export function formatLength(meters: number, unit: UnitSystem, decimals = 2): string {
  return `${metersToDisplayLength(meters, unit).toFixed(decimals)} ${lengthUnitLabel(unit)}`
}

export function cmToDisplayDiameter(cm: number, unit: UnitSystem): number {
  return unit === 'imperial' ? cm / CM_PER_INCH : cm
}

export function displayDiameterToCm(value: number, unit: UnitSystem): number {
  return unit === 'imperial' ? value * CM_PER_INCH : value
}

export function diameterUnitLabel(unit: UnitSystem): string {
  return unit === 'imperial' ? 'in' : 'cm'
}

/** For small (typically single-digit-cm) adjustments, e.g. the level-check mount correction. */
export function formatSmallLength(meters: number, unit: UnitSystem): string {
  if (unit === 'imperial') {
    return `${((meters * 100) / CM_PER_INCH).toFixed(1)} in`
  }
  return `${(meters * 100).toFixed(0)} cm`
}
