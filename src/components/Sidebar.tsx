import { useState, type FormEvent } from 'react'
import type { EffectType } from '../model'
import type { Actions } from '../actions'

interface Props {
  actions: Actions
}

export function Sidebar({ actions }: Props) {
  const [label, setLabel] = useState('')
  const [effect, setEffect] = useState<EffectType>('inhibits')
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'failed'>('idle')

  async function saveExample() {
    setSaveState((await actions.saveAsExample()) ? 'saved' : 'failed')
    setTimeout(() => setSaveState('idle'), 2000)
  }

  function submitThing(e: FormEvent) {
    e.preventDefault()
    if (!label.trim()) return
    actions.addThing(label.trim())
    setLabel('')
  }

  function submitEffect(e: FormEvent) {
    e.preventDefault()
    actions.addEffect(effect)
  }

  return (
    <aside className="sidebar">
      <form onSubmit={submitThing} className="panel">
        <h2>Add thing</h2>
        <div className="row">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Testosterone" />
          <button type="submit">Add</button>
        </div>
      </form>

      <form onSubmit={submitEffect} className="panel">
        <h2>Add effect</h2>
        <div className="row">
          <select value={effect} onChange={(e) => setEffect(e.target.value as EffectType)}>
            <option value="inhibits">inhibits</option>
            <option value="increases">increases</option>
          </select>
          <button type="submit">Add</button>
        </div>
        <p className="muted">Drag the chain handle on any card onto another card to link them.</p>
      </form>

      <section className="panel">
        <h2>Add text box</h2>
        <div className="row">
          <button onClick={() => actions.addNote()}>Add text box</button>
        </div>
        <p className="muted">Or double-click empty canvas to place one there.</p>
      </section>

      <div className="row">
        <button className="reset" onClick={actions.autoArrange}>Auto-arrange</button>
        <button className="reset" onClick={actions.loadExample}>Load example</button>
        {/* Saving writes to the codebase through the dev server, so it only exists under `npm run dev`. */}
        {import.meta.env.DEV && (
          <button className="reset" onClick={saveExample}>
            {saveState === 'saved' ? 'Saved' : saveState === 'failed' ? 'Save failed' : 'Save as example'}
          </button>
        )}
        <button className="reset" onClick={actions.clear}>Clear</button>
      </div>
    </aside>
  )
}
