import { useEffect, useRef, useState } from 'react'
import type { Location, Settings } from '../types'
import { LocationSwitcher } from './LocationSwitcher'
import { SettingsPanel } from './SettingsPanel'

interface Props {
  locations: Location[]
  currentLocationId: string
  onSelectLocation: (id: string) => void
  onAddLocation: () => void
  onRemoveLocation: (id: string) => void
  onRenameLocation: (id: string, name: string) => void
  onExport: () => void
  onImportFile: (file: File) => void
  importError: string | null
  settings: Settings
  onSettingsChange: (settings: Settings) => void
}

export function TopMenu({
  locations,
  currentLocationId,
  onSelectLocation,
  onAddLocation,
  onRemoveLocation,
  onRenameLocation,
  onExport,
  onImportFile,
  importError,
  settings,
  onSettingsChange,
}: Props) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div className="top-menu" ref={containerRef}>
      <button
        type="button"
        className="top-menu-button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">☰</span> Menu
      </button>
      {open && (
        <div className="top-menu-panel" role="menu">
          <LocationSwitcher
            locations={locations}
            currentLocationId={currentLocationId}
            onSelect={onSelectLocation}
            onAdd={onAddLocation}
            onRemove={onRemoveLocation}
            onRename={onRenameLocation}
            onExport={onExport}
            onImportFile={onImportFile}
            importError={importError}
          />
          <hr className="top-menu-divider" />
          <SettingsPanel settings={settings} onSettingsChange={onSettingsChange} />
        </div>
      )}
    </div>
  )
}
