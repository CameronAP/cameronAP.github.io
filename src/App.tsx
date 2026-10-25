import { useMemo, useState } from 'react'
import { computeValues, connectedIds, DEFAULT_BASE, exampleGraph, wouldCreateCycle, type ChainNode, type Graph } from './model'
import { GraphView } from './components/GraphView'
import type { Actions } from './actions'

const newId = () => crypto.randomUUID().slice(0, 8)

export default function App() {
  // Every run opens on the saved example (src/example.json); edits are not kept between runs.
  const [graph, setGraph] = useState<Graph>(exampleGraph)
  const values = useMemo(() => computeValues(graph), [graph])

  const updateNode = (id: string, patch: (n: ChainNode) => ChainNode) =>
    setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? patch(n) : n)) }))

  const actions: Actions = {
    addThing(label) {
      setGraph((g) => ({ ...g, nodes: [...g.nodes, { id: newId(), kind: 'thing', label, base: DEFAULT_BASE.thing }] }))
    },
    addEffect(effect) {
      // Base 0 so a fresh effect passes its input through one-to-one.
      setGraph((g) => ({ ...g, nodes: [...g.nodes, { id: newId(), kind: 'effect', effect, label: '', base: DEFAULT_BASE.effect }] }))
    },
    renameNode(id, label) {
      updateNode(id, (n) => ({ ...n, label }))
    },
    setBase(id, base) {
      updateNode(id, (n) => ({ ...n, base }))
    },
    removeNode(id) {
      setGraph((g) => ({
        ...g,
        nodes: g.nodes.filter((n) => n.id !== id),
        links: g.links.filter((l) => l.from !== id && l.to !== id),
      }))
    },
    moveNode(id, pos) {
      updateNode(id, (n) => ({ ...n, pos }))
    },
    scaleNode(id, scale) {
      updateNode(id, (n) => ({ ...n, scale }))
    },
    addLink(from, to) {
      if (from === to) return null
      if (graph.links.some((l) => l.from === from && l.to === to)) return 'Those are already chained.'
      if (wouldCreateCycle(graph, from, to)) return 'That chain would create a loop.'
      setGraph((g) => {
        const links = [...g.links, { id: newId(), from, to }]
        // Linking resets every bar in the now-joined chain to its default.
        const chain = connectedIds({ ...g, links }, from)
        const nodes = g.nodes.map((n) => (chain.has(n.id) ? { ...n, base: DEFAULT_BASE[n.kind] } : n))
        return { ...g, nodes, links }
      })
      return null
    },
    setLinkLabel(id, label) {
      setGraph((g) => ({ ...g, links: g.links.map((l) => (l.id === id ? { ...l, label } : l)) }))
    },
    removeLink(id) {
      setGraph((g) => ({ ...g, links: g.links.filter((l) => l.id !== id) }))
    },
    addNote(pos) {
      setGraph((g) => ({
        ...g,
        notes: [...g.notes, { id: newId(), text: '', pos: pos ?? { x: 24 + g.notes.length * 20, y: 24 + g.notes.length * 20 } }],
      }))
    },
    setNoteText(id, text) {
      setGraph((g) => ({ ...g, notes: g.notes.map((n) => (n.id === id ? { ...n, text } : n)) }))
    },
    moveNote(id, pos) {
      setGraph((g) => ({ ...g, notes: g.notes.map((n) => (n.id === id ? { ...n, pos } : n)) }))
    },
    resizeNote(id, size) {
      setGraph((g) => ({ ...g, notes: g.notes.map((n) => (n.id === id ? { ...n, size } : n)) }))
    },
    removeNote(id) {
      setGraph((g) => ({ ...g, notes: g.notes.filter((n) => n.id !== id) }))
    },
    autoArrange() {
      setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => ({ ...n, pos: undefined })) }))
    },
    loadExample() {
      setGraph(exampleGraph)
    },
    async saveAsExample() {
      // Handled by the dev server (see vite.config.ts), which writes src/example.json.
      try {
        const res = await fetch('/__save-example', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(graph),
        })
        return res.ok
      } catch {
        return false
      }
    },
    clear() {
      setGraph({ nodes: [], links: [], notes: [] })
    },
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>ChainVisual</h1>
        <p>Drag a card's chain handle onto another card to link them, then drag a level bar to watch the effect ripple downstream.</p>
      </header>
      <main className="app-main">
        <GraphView graph={graph} values={values} actions={actions} />
      </main>
    </div>
  )
}
