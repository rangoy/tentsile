import type { UnitSystem } from './types'

const METERS_PER_FOOT = 0.3048
const CM_PER_INCH = 2.54

/**
 * Display/input-boundary conversion only — every stored value (Settings,
 * TreeEntry, and everything geometry.ts computes) stays in meters regardless
 * of this setting. Only the number shown in a field or check message, and the
 * number read back out of an input, are converted; geometry.ts itself always
 * computes in meters and calls these helpers to format its `CheckResult.detail`
 * text in whichever unit `Settings.unitSystem` selects.
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

/** `meters`, read-only/display use only — editable length fields stay plain decimal feet (see InputForm). `decimals` only affects the metric ("m") form; imperial always renders as whole feet + whole inches. */
export function formatLength(meters: number, unit: UnitSystem, decimals = 2): string {
  if (unit === 'metric') {
    return `${meters.toFixed(decimals)} m`
  }
  const totalFeet = metersToDisplayLength(meters, unit)
  const sign = totalFeet < 0 ? '-' : ''
  const absFeet = Math.abs(totalFeet)
  let feet = Math.floor(absFeet)
  let inches = Math.round((absFeet - feet) * 12)
  if (inches === 12) {
    feet += 1
    inches = 0
  }
  return `${sign}${feet} ft ${inches} in`
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

export function formatDiameter(cm: number, unit: UnitSystem, decimals = 0): string {
  return `${cmToDisplayDiameter(cm, unit).toFixed(decimals)} ${diameterUnitLabel(unit)}`
}

/** For small (typically single-digit-cm) adjustments, e.g. the level-check mount correction. */
export function formatSmallLength(meters: number, unit: UnitSystem): string {
  if (unit === 'imperial') {
    return `${((meters * 100) / CM_PER_INCH).toFixed(1)} in`
  }
  return `${(meters * 100).toFixed(0)} cm`
}
