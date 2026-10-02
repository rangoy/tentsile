import { useEffect, useMemo, useState } from 'react'
import { comboKey } from './components/ComboTabs'
import { InputForm } from './components/InputForm'
import { ResultsPanel } from './components/ResultsPanel'
import { TopMenu } from './components/TopMenu'
import { UsageGuide } from './components/UsageGuide'
import { Visualization } from './components/Visualization'
import { DEFAULT_SETTINGS, isValidSettings } from './constants'
import { buildBackupPayload, parseBackupPayload } from './dataTransfer'
import {
  computeFloatingAnchor,
  formatTreeDisplay,
  mapFitToFrame,
  MAX_TREES,
  rankCombinations,
  solveFloatingAnchorTightness,
} from './geometry'
import { useLocalStorage } from './useLocalStorage'
import { useLocations } from './useLocations'
import type { FloatingAnchorState, OtherTreePoint, Point, Settings, TreeEntry, TreeReferences } from './types'

const DEFAULT_FLOATING_ANCHOR: FloatingAnchorState = {
  enabled: false,
  cornerId: 'C',
  redirectIndex: null,
  tightness: 0,
}

export default function App() {
  const {
    locations,
    currentLocation,
    currentLocationId,
    setCurrentLocationId,
    updateCurrentLocation,
    addLocation,
    removeLocation,
    renameLocation,
    importLocations,
  } = useLocations()
  const trees = currentLocation.trees
  const references = currentLocation.references
  const mirrored = currentLocation.mirrored ?? false
  const flippedVertically = currentLocation.flippedVertically ?? false
  const setTrees = (next: TreeEntry[]) => updateCurrentLocation({ trees: next })
  const setReferences = (next: TreeReferences) => updateCurrentLocation({ references: next })
  // Cycles none -> mirrored -> flipped -> mirrored+flipped -> none, covering
  // all 4 combinations of the two independent axis flips with one button.
  const cycleOrientation = () => {
    if (!mirrored && !flippedVertically) updateCurrentLocation({ mirrored: true, flippedVertically: false })
    else if (mirrored && !flippedVertically) updateCurrentLocation({ mirrored: false, flippedVertically: true })
    else if (!mirrored && flippedVertically) updateCurrentLocation({ mirrored: true, flippedVertically: true })
    else updateCurrentLocation({ mirrored: false, flippedVertically: false })
  }
  const [settings, setSettings] = useLocalStorage<Settings>('tentsile.settings', DEFAULT_SETTINGS, isValidSettings)
  const [importError, setImportError] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState('')
  const [floatingAnchorState, setFloatingAnchorState] = useState<FloatingAnchorState>(DEFAULT_FLOATING_ANCHOR)
  const [focusedEdit, setFocusedEdit] = useState<{ a: number; b: number } | null>(null)
  /** grove index of the tree currently being dragged on the canvas, or null — lets the input table highlight the matching row, see Visualization's onDraggingChange */
  const [draggingTreeIndex, setDraggingTreeIndex] = useState<number | null>(null)
  // Off by default so panning/zooming around the diagram can't accidentally
  // move a tree — the user has to deliberately switch into edit mode first.
  // Deliberately transient (not persisted to the location), since it's a
  // per-session safeguard rather than project data.
  const [editTreesEnabled, setEditTreesEnabled] = useState(false)
  // A tree with a currently-rejected (geometrically impossible) distance edit
  // keeps its last valid position (see InputForm.tsx) but is excluded from
  // combos/visualization entirely until fixed — keyed by index, value is the
  // warning message InputForm shows for that row.
  const [invalidTrees, setInvalidTrees] = useState<Record<number, string>>({})
  const setTreeValidity = (index: number, message: string | null) => {
    setInvalidTrees((prev) => {
      if (message === null) {
        if (!(index in prev)) return prev
        const next = { ...prev }
        delete next[index]
        return next
      }
      return { ...prev, [index]: message }
    })
  }
  // Removing a tree shifts every later index, so a stale entry could end up
  // attached to the wrong row — simplest correct fix is to drop them all.
  // Switching references also invalidates them (the baseline they were
  // measured against no longer applies).
  useEffect(() => setInvalidTrees({}), [references.a, references.b, trees.length])
  const excludedTreeIndices = useMemo(() => new Set(Object.keys(invalidTrees).map(Number)), [invalidTrees])

  const { combos, positions } = useMemo(
    () => rankCombinations(trees, settings, 5, excludedTreeIndices),
    [trees, settings, excludedTreeIndices],
  )

  const selected = combos.find((c) => comboKey(c) === selectedKey) ?? combos[0]

  // Plotted straight from the grove's own shared positions (not re-projected per
  // combo) so they — and the combo triangle itself, via stableFit below — stay
  // visually put when switching combos, rather than the whole diagram reorienting
  // arbitrarily each time (see mapFitToFrame's own comment for why that happened).
  const otherTrees = useMemo(() => {
    if (!selected) return []
    const [i, j, k] = selected.indices
    const result: OtherTreePoint[] = []
    for (let idx = 0; idx < trees.length; idx++) {
      if (idx === i || idx === j || idx === k) continue
      if (excludedTreeIndices.has(idx)) continue
      const pos = positions[idx]
      if (!pos) continue
      result.push({ index: idx, display: formatTreeDisplay(idx + 1, trees[idx].label), pos, diameter: trees[idx].diameter })
    }
    return result
  }, [trees, positions, selected, excludedTreeIndices])

  // selected.fit is solved in its own arbitrary local frame (see mapFitToFrame) —
  // remapped here into the grove's shared global frame so the displayed triangle
  // lines up with otherTrees above and stays stable across combo switches. Falls
  // back to the raw local fit only if a selected combo's own positions somehow
  // aren't in `positions` (shouldn't happen — rankCombinations already skips any
  // combo lacking them).
  const stableFit = useMemo(() => {
    if (!selected) return null
    const [i, j, k] = selected.indices
    const gA = positions[i]
    const gB = positions[j]
    const gC = positions[k]
    return gA && gB && gC ? mapFitToFrame(selected.fit, gA, gB, gC) : selected.fit
  }, [selected, positions])

  const selectedDiameters = selected
    ? {
        A: trees[selected.indices[0]]?.diameter ?? null,
        B: trees[selected.indices[1]]?.diameter ?? null,
        C: trees[selected.indices[2]]?.diameter ?? null,
      }
    : null

  const redirectTree =
    otherTrees.find((t) => t.index === floatingAnchorState.redirectIndex) ?? otherTrees[0] ?? null

  const floatingAnchorResult = useMemo(() => {
    if (!floatingAnchorState.enabled || !redirectTree || !selected || !selectedDiameters || !stableFit) return null
    return computeFloatingAnchor(
      stableFit,
      floatingAnchorState.cornerId,
      redirectTree.pos,
      floatingAnchorState.tightness / 100,
      { diameterA: selectedDiameters.A, diameterB: selectedDiameters.B, diameterC: selectedDiameters.C },
      settings,
      selected.labels,
    )
  }, [floatingAnchorState, redirectTree, selected, selectedDiameters, stableFit, settings])

  const handleRemoveTree = (index: number) => {
    setTrees(trees.filter((_, i) => i !== index))
    const shift = (refIndex: number) => (refIndex > index ? refIndex - 1 : refIndex)
    setReferences({ a: shift(references.a), b: shift(references.b) })
  }

  const handleTreeMove = (index: number, pos: Point) => {
    setTrees(trees.map((t, i) => (i === index ? { ...t, x: pos.x, y: pos.y } : t)))
  }

  const handleAddTreeAt = (pos: Point) => {
    if (trees.length >= MAX_TREES) return
    setTrees([...trees, { label: '', diameter: null, x: pos.x, y: pos.y }])
  }

  const handleExport = () => {
    const payload = buildBackupPayload(locations, settings)
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tentsile-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text()
      const result = parseBackupPayload(text)
      const existingIds = new Set(locations.map((l) => l.id))
      const updateCount = result.locations.filter((l) => existingIds.has(l.id)).length
      const newCount = result.locations.length - updateCount
      const message =
        `Import ${result.locations.length} location(s)? ${newCount} new` +
        (updateCount > 0 ? `, ${updateCount} will overwrite existing location(s) with the same ID` : '') +
        '. Other saved locations are kept.'
      const confirmed = window.confirm(message)
      if (!confirmed) return
      importLocations(result.locations)
      if (result.settings) setSettings(result.settings)
      setImportError(null)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed.')
    }
  }

  const handleReferenceChange = (which: 'a' | 'b', newIndex: number) => {
    const next = which === 'a' ? { a: newIndex, b: references.b } : { a: references.a, b: newIndex }
    setReferences(next)
  }

  // Auto-solves the *least* tightness that reaches a clean "Good fit" (see
  // solveFloatingAnchorTightness) for a given corner/tree pair, rather than
  // making the user hunt for it by dragging a slider or cranking it needlessly
  // tight — "calculate the pull needed to reach a good fit," not pick it
  // manually, and "the least pull that gives an OK result," not the most
  // (specifically a clean pass, not merely no check technically failing —
  // that looser bar found a 77% "fix" that visibly wrecked the layout when
  // 6% already gave a clean good fit, caught directly from a screenshot).
  // Shared by the explicit corner/tree-change handler below and the
  // combo-switch effect further down: "corner C" is just a role within
  // whichever 3-tree combo is currently selected, not a fixed tree identity,
  // so switching combos needs
  // the same re-solve as explicitly picking a different corner or tree does
  // — carrying over a stale tightness computed for the *previous* combo's
  // geometry produced visibly nonsensical grab points once the combo changed
  // under them (caught from a screenshot showing the redirect tree and grab
  // point nowhere near the rest of the layout).
  const autoSolveFloatingAnchor = (cornerId: FloatingAnchorState['cornerId'], redirectIndexHint: number | null) => {
    if (!selected || !selectedDiameters || !stableFit) return null
    const nextRedirectTree = otherTrees.find((t) => t.index === redirectIndexHint) ?? otherTrees[0] ?? null
    if (!nextRedirectTree) return null
    const tightness = solveFloatingAnchorTightness(
      stableFit,
      cornerId,
      nextRedirectTree.pos,
      { diameterA: selectedDiameters.A, diameterB: selectedDiameters.B, diameterC: selectedDiameters.C },
      settings,
      selected.labels,
    )
    // The slider only stores whole percent, but the solved value is the
    // *exact* least tightness that crosses into a clean pass — rounding to
    // the nearest percent can round down past that crossing and land back
    // in "tight" (caught directly: solved 4.12%, rounded to 4%, which was
    // still short of the pass boundary the solver actually found). Round up
    // instead, since more pull is always the direction that keeps the result
    // at least as tight as what was solved for.
    return { redirectIndex: nextRedirectTree.index, tightness: Math.min(100, Math.ceil(tightness * 100)) }
  }

  // Never on a manual slider drag (`tightness` in the patch) or the explicit
  // "auto-fit" button (handled separately below) — this only re-solves on
  // the changes that make the *previous* tightness meaningless outright.
  const handleFloatingAnchorChange = (patch: Partial<FloatingAnchorState>) => {
    const next = { ...floatingAnchorState, ...patch }
    const shouldAutoSolve =
      (patch.cornerId !== undefined && patch.cornerId !== floatingAnchorState.cornerId) ||
      (patch.redirectIndex !== undefined && patch.redirectIndex !== floatingAnchorState.redirectIndex) ||
      (patch.enabled === true && !floatingAnchorState.enabled)

    if (shouldAutoSolve) {
      const solved = autoSolveFloatingAnchor(next.cornerId, next.redirectIndex)
      if (solved) Object.assign(next, solved)
    }

    setFloatingAnchorState(next)
  }

  // Explicit re-solve for the "auto-fit" button — lets the user snap back to
  // the computed best tightness after manually dragging the slider away from
  // it, without having to re-toggle the corner/tree dropdowns to trigger it.
  const handleAutoFitFloatingAnchor = () => {
    const solved = autoSolveFloatingAnchor(floatingAnchorState.cornerId, floatingAnchorState.redirectIndex)
    if (solved) setFloatingAnchorState((prev) => ({ ...prev, ...solved }))
  }

  // See autoSolveFloatingAnchor above: which real tree each corner letter
  // means depends on the selected combo, so switching combos needs the same
  // re-solve explicitly changing the corner/tree dropdowns already gets.
  useEffect(() => {
    if (!floatingAnchorState.enabled) return
    const solved = autoSolveFloatingAnchor(floatingAnchorState.cornerId, floatingAnchorState.redirectIndex)
    if (solved) setFloatingAnchorState((prev) => ({ ...prev, ...solved }))
  }, [selected ? comboKey(selected) : null])

  // A different location has its own trees/references entirely — carrying
  // over a floating-anchor redirect picked against the previous location's
  // trees makes no sense once switched.
  useEffect(() => {
    setFloatingAnchorState(DEFAULT_FLOATING_ANCHOR)
    setFocusedEdit(null)
    setInvalidTrees({})
    setDraggingTreeIndex(null)
  }, [currentLocationId])

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-text">
          <h1>Tentsile Setup Calculator</h1>
          <p className="subtitle">
            Enter your candidate trees to check which 3-tree combination fits best and get strap
            lengths for a Tentsile-style tree tent.
          </p>
        </div>
        <TopMenu
          locations={locations}
          currentLocationId={currentLocationId}
          onSelectLocation={setCurrentLocationId}
          onAddLocation={addLocation}
          onRemoveLocation={removeLocation}
          onRenameLocation={renameLocation}
          onExport={handleExport}
          onImportFile={handleImportFile}
          importError={importError}
          settings={settings}
          onSettingsChange={setSettings}
        />
      </header>
      <UsageGuide />
      <main>
        <div className="grid-viz">
          {selected && selectedDiameters && stableFit && (
            <Visualization
              fit={stableFit}
              diameters={selectedDiameters}
              labels={selected.labels}
              comboIndices={selected.indices}
              otherTrees={otherTrees}
              combos={combos}
              selectedKey={comboKey(selected)}
              onSelectCombo={setSelectedKey}
              ratchetLength={settings.ratchetLength}
              unitSystem={settings.unitSystem}
              floatingAnchor={floatingAnchorResult && redirectTree ? { result: floatingAnchorResult, redirectTree } : null}
              focusedEdit={focusedEdit}
              mirrored={mirrored}
              flippedVertically={flippedVertically}
              onCycleOrientation={cycleOrientation}
              onTreeMove={handleTreeMove}
              onAddTreeAt={handleAddTreeAt}
              onDraggingChange={setDraggingTreeIndex}
              editTreesEnabled={editTreesEnabled}
              onToggleEditTrees={() => setEditTreesEnabled((v) => !v)}
            />
          )}
        </div>
        <div className="grid-input">
          <InputForm
            trees={trees}
            onTreesChange={setTrees}
            onRemoveTree={handleRemoveTree}
            references={references}
            onReferenceChange={handleReferenceChange}
            onFocusEdit={setFocusedEdit}
            settings={settings}
            invalidTrees={invalidTrees}
            onTreeValidityChange={setTreeValidity}
            draggingTreeIndex={draggingTreeIndex}
          />
        </div>
        <div className="grid-results">
          {selected && selectedDiameters && stableFit && (
            <ResultsPanel
              fit={stableFit}
              labels={selected.labels}
              ratchetLength={settings.ratchetLength}
              unitSystem={settings.unitSystem}
              otherTrees={otherTrees}
              floatingAnchorState={floatingAnchorState}
              onFloatingAnchorChange={handleFloatingAnchorChange}
              onAutoFitFloatingAnchor={handleAutoFitFloatingAnchor}
              floatingAnchorResult={floatingAnchorResult}
              redirectTree={redirectTree}
            />
          )}
        </div>
      </main>
      <footer className="disclaimer">
        For use with tents from <a href="https://www.tentsile.com/" target="_blank" rel="noopener noreferrer">tentsile.com</a>.
        Not affiliated with or endorsed by Tentsile. Built with AI assistance from Claude. Found an
        issue? Report it on{' '}
        <a href="https://github.com/rangoy/tentsile/issues" target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        .
      </footer>
    </div>
  )
}
