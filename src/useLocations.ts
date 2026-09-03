import { useEffect, useState } from 'react'
import { createLocation, isValidLocation, isValidReferences } from './constants'
import type { Location, TreeEntry, TreeReferences } from './types'

const LOCATIONS_KEY = 'tentsile.locations'
const CURRENT_ID_KEY = 'tentsile.currentLocationId'
const LEGACY_TREES_KEY = 'tentsile.trees'
const LEGACY_REFERENCES_KEY = 'tentsile.references'

/**
 * Folds pre-multi-location data (a single flat grove) into a "Location 1"
 * entry. Read-only by design — under React 18 StrictMode dev double-invokes
 * useState's lazy initializer to catch impure renders, so clearing the old
 * keys here (a side effect) meant the second invocation saw them already
 * gone and silently fell back to defaults, dropping the migrated trees.
 * Callers must clear the legacy keys separately, from a useEffect.
 */
function migrateLegacyLocation(): Location | null {
  try {
    const rawTrees = window.localStorage.getItem(LEGACY_TREES_KEY)
    if (rawTrees === null) return null
    const trees = JSON.parse(rawTrees) as TreeEntry[]
    if (!Array.isArray(trees)) return null

    let references: TreeReferences | undefined
    const rawReferences = window.localStorage.getItem(LEGACY_REFERENCES_KEY)
    if (rawReferences !== null) {
      const parsed = JSON.parse(rawReferences) as TreeReferences
      if (isValidReferences(parsed)) references = parsed
    }

    return createLocation('Location 1', trees, references)
  } catch {
    return null
  }
}

function loadInitialLocations(): Location[] {
  try {
    const raw = window.localStorage.getItem(LOCATIONS_KEY)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isValidLocation)) {
        return parsed
      }
    }
  } catch {
    // fall through to legacy migration / default below
  }
  return [migrateLegacyLocation() ?? createLocation('Location 1')]
}

function loadInitialCurrentId(locations: Location[]): string {
  try {
    const stored = window.localStorage.getItem(CURRENT_ID_KEY)
    if (stored !== null && locations.some((l) => l.id === stored)) return stored
  } catch {
    // ignore
  }
  return locations[0].id
}

export function useLocations() {
  const [locations, setLocations] = useState<Location[]>(loadInitialLocations)
  const [currentLocationId, setCurrentLocationId] = useState<string>(() => loadInitialCurrentId(locations))

  // One-time cleanup of the pre-multi-location keys, now that whatever they
  // held (if anything) has been folded into `locations` by the initializer.
  useEffect(() => {
    try {
      window.localStorage.removeItem(LEGACY_TREES_KEY)
      window.localStorage.removeItem(LEGACY_REFERENCES_KEY)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(LOCATIONS_KEY, JSON.stringify(locations))
    } catch {
      // ignore write failures (e.g. private browsing quota)
    }
  }, [locations])

  useEffect(() => {
    try {
      window.localStorage.setItem(CURRENT_ID_KEY, currentLocationId)
    } catch {
      // ignore
    }
  }, [currentLocationId])

  const currentLocation = locations.find((l) => l.id === currentLocationId) ?? locations[0]

  const updateCurrentLocation = (patch: Partial<Pick<Location, 'trees' | 'references'>>) => {
    setLocations((prev) => prev.map((l) => (l.id === currentLocation.id ? { ...l, ...patch } : l)))
  }

  const addLocation = () => {
    const next = createLocation(`Location ${locations.length + 1}`)
    setLocations((prev) => [...prev, next])
    setCurrentLocationId(next.id)
  }

  const removeLocation = (id: string) => {
    if (locations.length <= 1) return
    const next = locations.filter((l) => l.id !== id)
    setLocations(next)
    if (id === currentLocationId) setCurrentLocationId(next[0].id)
  }

  const renameLocation = (id: string, name: string) => {
    setLocations((prev) => prev.map((l) => (l.id === id ? { ...l, name } : l)))
  }

  return {
    locations,
    currentLocation,
    currentLocationId,
    setCurrentLocationId,
    updateCurrentLocation,
    addLocation,
    removeLocation,
    renameLocation,
  }
}
