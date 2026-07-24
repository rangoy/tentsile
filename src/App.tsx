import { useMemo, useState } from 'react'
import { comboKey } from './components/ComboTabs'
import { InputForm } from './components/InputForm'
import { ResultsPanel } from './components/ResultsPanel'
import { Visualization } from './components/Visualization'
import { DEFAULT_SETTINGS, DEFAULT_TREES } from './constants'
import { projectOtherTrees, rankCombinations } from './geometry'
import { useLocalStorage } from './useLocalStorage'
import type { Settings, TreeEntry } from './types'

export default function App() {
  const [trees, setTrees] = useLocalStorage<TreeEntry[]>('tentsile.trees', DEFAULT_TREES)
  const [settings, setSettings] = useLocalStorage<Settings>('tentsile.settings', DEFAULT_SETTINGS)
  const [selectedKey, setSelectedKey] = useState('')

  const { combos, positionErrors, positions } = useMemo(
    () => rankCombinations(trees, settings, 5),
    [trees, settings],
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

  return (
    <div className="app">
      <header>
        <h1>Tentsile Setup Calculator</h1>
        <p className="subtitle">
          Enter your candidate trees to check which 3-tree combination fits best and get strap
          lengths for a Tentsile-style tree tent.
        </p>
      </header>
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
              tailLength={settings.tailLength}
            />
          )}
        </div>
        <div className="grid-input">
          <InputForm
            trees={trees}
            onTreesChange={setTrees}
            settings={settings}
            onSettingsChange={setSettings}
            positionErrors={positionErrors}
          />
        </div>
        <div className="grid-results">
          {selected && selectedDiameters && (
            <ResultsPanel fit={selected.fit} labels={selected.labels} tailLength={settings.tailLength} />
          )}
        </div>
      </main>
      <footer className="disclaimer">
        For use with tents from <a href="https://www.tentsile.com/" target="_blank" rel="noopener noreferrer">tentsile.com</a>.
        Not affiliated with or endorsed by Tentsile. Built with AI assistance from Claude.
      </footer>
    </div>
  )
}
