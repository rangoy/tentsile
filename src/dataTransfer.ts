import { isValidLocation, isValidSettings } from './constants'
import type { Location, Settings } from './types'

export interface BackupPayload {
  version: 1
  exportedAt: string
  settings: Settings
  locations: Location[]
}

export function buildBackupPayload(locations: Location[], settings: Settings): BackupPayload {
  return { version: 1, exportedAt: new Date().toISOString(), settings, locations }
}

export interface ParsedImport {
  locations: Location[]
  /** null when the backup has no (or an invalid) settings block — caller should leave current settings alone */
  settings: Settings | null
}

/** Throws a plain Error with a user-facing message on any validation failure. */
export function parseBackupPayload(raw: string): ParsedImport {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('That file is not valid JSON.')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Expected a JSON object with a "locations" array.')
  }

  const value = parsed as Partial<BackupPayload>
  if (!Array.isArray(value.locations) || value.locations.length === 0) {
    throw new Error('Missing or empty "locations" array.')
  }
  if (!value.locations.every(isValidLocation)) {
    throw new Error('One or more locations are missing required fields.')
  }

  const settings = value.settings && isValidSettings(value.settings) ? value.settings : null
  return { locations: value.locations, settings }
}
