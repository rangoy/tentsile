import { useEffect, useMemo, useState } from 'react'
import { comboKey } from './components/ComboTabs'
import { InputForm } from './components/InputForm'
import { LocationSwitcher } from './components/LocationSwitcher'
import { ResultsPanel } from './components/ResultsPanel'
import { UsageGuide } from './components/UsageGuide'
import { Visualization } from './components/Visualization'
import { DEFAULT_SETTINGS, isValidSettings } from './constants'
import {
  computeFloatingAnchor,
  projectOtherTrees,
  rankCombinations,
  recomputeTreesForReferences,
  solveFloatingAnchorTightness,
} from './geometry'
import { useLocalStorage } from './useLocalStorage'
import { useLocations } from './useLocations'
import type { FloatingAnchorState, Settings, TreeEntry, TreeReferences } from './types'

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
  } = useLocations()
  const trees = currentLocation.trees
  const references = currentLocation.references
  const setTrees = (next: TreeEntry[]) => updateCurrentLocation({ trees: next })
  const setReferences = (next: TreeReferences) => updateCurrentLocation({ references: next })
  const [settings, setSettings] = useLocalStorage<Settings>('tentsile.settings', DEFAULT_SETTINGS, isValidSettings)
  const [referenceError, setReferenceError] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState('')
  const [floatingAnchorState, setFloatingAnchorState] = useState<FloatingAnchorState>(DEFAULT_FLOATING_ANCHOR)

  const { combos, positionErrors, positions } = useMemo(
    () => rankCombinations(trees, settings, 5, references.a, references.b),
    [trees, settings, references],
  )

  const selected = combos.find((c) => comboKey(c) === selectedKey) ?? combos[0]

  const otherTrees = useMemo(
    () => (selected ? projectOtherTrees(trees, positions, selected.indices, selected.fit.triangle) : []),
    [trees, positions, selected],
  )

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
    if (!floatingAnchorState.enabled || !redirectTree || !selected || !selectedDiameters) return null
    return computeFloatingAnchor(
      selected.fit,
      floatingAnchorState.cornerId,
      redirectTree.pos,
      floatingAnchorState.tightness / 100,
      { diameterA: selectedDiameters.A, diameterB: selectedDiameters.B, diameterC: selectedDiameters.C },
      settings,
      selected.labels,
    )
  }, [floatingAnchorState, redirectTree, selected, selectedDiameters, settings])

  const handleRemoveTree = (index: number) => {
    setTrees(trees.filter((_, i) => i !== index))
    const shift = (refIndex: number) => (refIndex > index ? refIndex - 1 : refIndex)
    setReferences({ a: shift(references.a), b: shift(references.b) })
  }

  const handleReferenceChange = (which: 'a' | 'b', newIndex: number) => {
    const next = which === 'a' ? { a: newIndex, b: references.b } : { a: references.a, b: newIndex }
    const result = recomputeTreesForReferences(trees, references.a, references.b, next.a, next.b)
    if (result.error) {
      setReferenceError(result.error)
      return
    }
    setReferenceError(null)
    setTrees(result.trees)
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
    if (!selected || !selectedDiameters) return null
    const nextRedirectTree = otherTrees.find((t) => t.index === redirectIndexHint) ?? otherTrees[0] ?? null
    if (!nextRedirectTree) return null
    const tightness = solveFloatingAnchorTightness(
      selected.fit,
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
  // over a reference-change error or a floating-anchor redirect picked
  // against the previous location's trees makes no sense once switched.
  useEffect(() => {
    setReferenceError(null)
    setFloatingAnchorState(DEFAULT_FLOATING_ANCHOR)
  }, [currentLocationId])

  return (
    <div className="app">
      <header>
        <h1>Tentsile Setup Calculator</h1>
        <p className="subtitle">
          Enter your candidate trees to check which 3-tree combination fits best and get strap
          lengths for a Tentsile-style tree tent.
        </p>
      </header>
      <UsageGuide />
      <LocationSwitcher
        locations={locations}
        currentLocationId={currentLocationId}
        onSelect={setCurrentLocationId}
        onAdd={addLocation}
        onRemove={removeLocation}
        onRename={renameLocation}
      />
      <main>
        <div className="grid-viz">
          {selected && selectedDiameters && (
            <Visualization
              fit={selected.fit}
              diameters={selectedDiameters}
              labels={selected.labels}
              otherTrees={otherTrees}
              combos={combos}
              selectedKey={comboKey(selected)}
              onSelectCombo={setSelectedKey}
              ratchetLength={settings.ratchetLength}
              unitSystem={settings.unitSystem}
              floatingAnchor={floatingAnchorResult && redirectTree ? { result: floatingAnchorResult, redirectTree } : null}
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
            referenceError={referenceError}
            settings={settings}
            onSettingsChange={setSettings}
            positionErrors={positionErrors}
          />
        </div>
        <div className="grid-results">
          {selected && selectedDiameters && (
            <ResultsPanel
              fit={selected.fit}
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
