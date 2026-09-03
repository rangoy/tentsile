import type { Location } from '../types'

interface Props {
  locations: Location[]
  currentLocationId: string
  onSelect: (id: string) => void
  onAdd: () => void
  onRemove: (id: string) => void
  onRename: (id: string, name: string) => void
}

export function LocationSwitcher({ locations, currentLocationId, onSelect, onAdd, onRemove, onRename }: Props) {
  const current = locations.find((l) => l.id === currentLocationId) ?? locations[0]

  const handleRemove = () => {
    if (locations.length <= 1) return
    if (!window.confirm(`Delete "${current.name}" and its trees? This can't be undone.`)) return
    onRemove(current.id)
  }

  return (
    <div className="panel location-switcher">
      <label>
        Location
        <select value={current.id} onChange={(e) => onSelect(e.target.value)}>
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.name || 'Untitled location'}
            </option>
          ))}
        </select>
      </label>
      <input
        className="location-name-input"
        type="text"
        value={current.name}
        placeholder="Location name"
        onChange={(e) => onRename(current.id, e.target.value)}
        aria-label="Rename location"
      />
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
  )
}
