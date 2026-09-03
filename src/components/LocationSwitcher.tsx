import { useRef } from 'react'
import type { Location } from '../types'

interface Props {
  locations: Location[]
  currentLocationId: string
  onSelect: (id: string) => void
  onAdd: () => void
  onRemove: (id: string) => void
  onRename: (id: string, name: string) => void
  onExport: () => void
  onImportFile: (file: File) => void
  importError: string | null
}

export function LocationSwitcher({
  locations,
  currentLocationId,
  onSelect,
  onAdd,
  onRemove,
  onRename,
  onExport,
  onImportFile,
  importError,
}: Props) {
  const current = locations.find((l) => l.id === currentLocationId) ?? locations[0]
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleRemove = () => {
    if (locations.length <= 1) return
    if (!window.confirm(`Delete "${current.name}" and its trees? This can't be undone.`)) return
    onRemove(current.id)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) onImportFile(file)
  }

  return (
    <div className="menu-section">
      <h3>Location</h3>
      <label className="menu-field">
        <select value={current.id} onChange={(e) => onSelect(e.target.value)}>
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.name || 'Untitled location'}
            </option>
          ))}
        </select>
      </label>
      <input
        className="menu-field"
        type="text"
        value={current.name}
        placeholder="Location name"
        onChange={(e) => onRename(current.id, e.target.value)}
        aria-label="Rename location"
      />
      <div className="menu-button-row">
        <button type="button" className="location-button" onClick={onAdd}>
          + New location
        </button>
        <button
          type="button"
          className="location-button location-remove"
          onClick={handleRemove}
          disabled={locations.length <= 1}
        >
          Delete location
        </button>
      </div>
      <div className="menu-button-row">
        <button type="button" className="location-button" onClick={onExport}>
          Export all (.json)
        </button>
        <button type="button" className="location-button" onClick={() => fileInputRef.current?.click()}>
          Import…
        </button>
        <input ref={fileInputRef} type="file" accept="application/json" onChange={handleFileChange} hidden />
      </div>
      {importError && (
        <ul className="check-list">
          <li className="check-fail">
            <span className="check-detail">{importError}</span>
          </li>
        </ul>
      )}
    </div>
  )
}
