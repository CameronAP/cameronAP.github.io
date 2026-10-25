import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react'
import { depths, influence, isLocked, type ChainNode, type Graph } from '../model'
import type { Actions } from '../actions'

// Fixed shape geometry lets chains be drawn without measuring the DOM.
// Things are circles; effects are diamonds.
// A diamond's usable middle is smaller than a circle's, so it is drawn larger to fit the same controls.
const THING_D = 180
const EFFECT_D = 220
const SLOT = Math.max(THING_D, EFFECT_D)
const COL_STEP = SLOT + 90
const ROW_STEP = SLOT + 20
const PAD = 24
const NOTE_W = 220
/** Rough text-box height, only used to size the scrollable canvas. */
const NOTE_H_EST = 60
const NOTE_MIN = { w: 80, h: 36 }

interface Props {
  graph: Graph
  values: Map<string, number>
  actions: Actions
}

type Point = { x: number; y: number }

const SCALE_RANGE = { min: 0.5, max: 3 }

/** Unscaled size of a card. Its contents are laid out at this size, then scaled as a whole. */
const baseSize = (n: ChainNode) => (n.kind === 'thing' ? THING_D : EFFECT_D)

/** Point on a node's outline (circle or diamond of diameter `size`, centered at `c`), heading toward `to`. */
function edgePoint(n: ChainNode, size: number, c: Point, to: Point): Point {
  const dx = to.x - c.x
  const dy = to.y - c.y
  const r = size / 2
  const t = n.kind === 'thing' ? r / (Math.hypot(dx, dy) || 1) : r / (Math.abs(dx) + Math.abs(dy) || 1)
  return { x: c.x + dx * t, y: c.y + dy * t }
}

interface WrapFieldProps {
  value: string
  placeholder: string
  onChange: (v: string) => void
  className?: string
  /** Allow Enter to start a new line. Otherwise the field is a single paragraph. */
  multiline?: boolean
}

/** A text field that wraps long text onto more lines and grows to fit. */
function WrapField({ value, placeholder, onChange, className = 'card-label', multiline = false }: WrapFieldProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current!
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      className={className}
      rows={1}
      value={value}
      placeholder={placeholder}
      // Single-paragraph fields: Enter finishes editing, and pasted line breaks become spaces.
      onKeyDown={(e) => !multiline && e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
      onChange={(e) => onChange(multiline ? e.target.value : e.target.value.replace(/\s*\n\s*/g, ' '))}
      aria-label={multiline ? 'Text box' : 'Name'}
    />
  )
}

/** Id of the node card under a screen point, if any. */
function nodeAt(clientX: number, clientY: number): string | null {
  const el = document.elementFromPoint(clientX, clientY)
  return el?.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId ?? null
}

export function GraphView({ graph, values, actions }: Props) {
  const innerRef = useRef<HTMLDivElement>(null)
  // Moving a card or text box: its live position, and where the pointer grabbed it.
  const [drag, setDrag] = useState<{ kind: 'node' | 'note'; id: string; pos: Point } | null>(null)
  const grab = useRef<Point>({ x: 0, y: 0 })
  // Pulling a new chain out of a card's handle: the loose end follows the pointer.
  const [linking, setLinking] = useState<{ from: string; end: Point; over: string | null } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Resizing a text box from its corner handle: the live size, and the pointer/size when it started.
  const [resizing, setResizing] = useState<{ id: string; size: { w: number; h: number } } | null>(null)
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 })
  // Scaling a card from its scale handle: the live scale, and the pointer/size when it started.
  const [scaling, setScaling] = useState<{ id: string; scale: number } | null>(null)
  const scaleStart = useRef({ x: 0, y: 0, size: 0 })

  const scaleOf = (n: ChainNode) => (scaling?.id === n.id ? scaling.scale : (n.scale ?? 1))
  const sizeOf = (n: ChainNode) => baseSize(n) * scaleOf(n)

  // Positions are top-left corners. Dragged nodes keep their saved position;
  // the rest get an auto column/row slot, centered within it.
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const depth = depths(graph)
  const rowInCol = new Map<number, number>()
  const pos = new Map<string, Point>()
  for (const n of graph.nodes) {
    const col = depth.get(n.id) ?? 0
    const row = rowInCol.get(col) ?? 0
    rowInCol.set(col, row + 1)
    const inset = Math.max(0, (SLOT - sizeOf(n)) / 2)
    pos.set(n.id, n.pos ?? { x: PAD + col * COL_STEP + inset, y: PAD + row * ROW_STEP + inset })
  }
  if (drag?.kind === 'node') pos.set(drag.id, drag.pos)
  const notePos = new Map(graph.notes.map((n) => [n.id, n.pos]))
  if (drag?.kind === 'note') notePos.set(drag.id, drag.pos)

  const center = (id: string) => {
    const p = pos.get(id)!
    const r = sizeOf(byId.get(id)!) / 2
    return { x: p.x + r, y: p.y + r }
  }

  const noteSize = (id: string, size?: { w: number; h: number }) => (resizing?.id === id ? resizing.size : size)
  const noteBoxes = graph.notes.map((n) => {
    const p = notePos.get(n.id)!
    const size = noteSize(n.id, n.size)
    return { x: p.x + (size?.w ?? NOTE_W), y: p.y + (size?.h ?? NOTE_H_EST) }
  })
  const width = Math.max(0, ...graph.nodes.map((n) => pos.get(n.id)!.x + sizeOf(n)), ...noteBoxes.map((b) => b.x)) + PAD
  const height = Math.max(0, ...graph.nodes.map((n) => pos.get(n.id)!.y + sizeOf(n)), ...noteBoxes.map((b) => b.y)) + PAD
  const empty = graph.nodes.length === 0 && graph.notes.length === 0

  const toCanvas = (clientX: number, clientY: number): Point => {
    const r = innerRef.current!.getBoundingClientRect()
    return { x: clientX - r.left, y: clientY - r.top }
  }

  function flash(msg: string) {
    setNotice(msg)
    setTimeout(() => setNotice((m) => (m === msg ? null : m)), 2500)
  }

  // --- moving cards and text boxes ---
  function onCardDown(e: PointerEvent<HTMLDivElement>, kind: 'node' | 'note', id: string) {
    // Leave the text fields, level bar, buttons and chain handle usable.
    if ((e.target as HTMLElement).closest('input, textarea, button, select, .chain-handle, .scale-handle, .note-resize')) return
    const p = (kind === 'node' ? pos : notePos).get(id)!
    grab.current = { x: e.clientX - p.x, y: e.clientY - p.y }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ kind, id, pos: p })
  }

  function onCardMove(e: PointerEvent<HTMLDivElement>) {
    if (!drag) return
    setDrag({
      ...drag,
      pos: { x: Math.max(0, e.clientX - grab.current.x), y: Math.max(0, e.clientY - grab.current.y) },
    })
  }

  function onCardUp() {
    if (!drag) return
    if (drag.kind === 'node') actions.moveNode(drag.id, drag.pos)
    else actions.moveNote(drag.id, drag.pos)
    setDrag(null)
  }

  const dragProps = (kind: 'node' | 'note', id: string) => ({
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => onCardDown(e, kind, id),
    onPointerMove: onCardMove,
    onPointerUp: onCardUp,
    onPointerCancel: onCardUp,
  })

  // --- resizing text boxes ---
  function onResizeDown(e: PointerEvent<HTMLDivElement>, id: string) {
    e.stopPropagation()
    const box = e.currentTarget.parentElement!
    resizeStart.current = { x: e.clientX, y: e.clientY, w: box.offsetWidth, h: box.offsetHeight }
    e.currentTarget.setPointerCapture(e.pointerId)
    setResizing({ id, size: { w: box.offsetWidth, h: box.offsetHeight } })
  }

  function onResizeMove(e: PointerEvent<HTMLDivElement>) {
    if (!resizing) return
    const s = resizeStart.current
    setResizing({
      id: resizing.id,
      size: { w: Math.max(NOTE_MIN.w, s.w + e.clientX - s.x), h: Math.max(NOTE_MIN.h, s.h + e.clientY - s.y) },
    })
  }

  function onResizeUp() {
    if (!resizing) return
    actions.resizeNote(resizing.id, resizing.size)
    setResizing(null)
  }

  // --- scaling cards ---
  function onScaleDown(e: PointerEvent<HTMLDivElement>, n: ChainNode) {
    e.stopPropagation()
    scaleStart.current = { x: e.clientX, y: e.clientY, size: sizeOf(n) }
    e.currentTarget.setPointerCapture(e.pointerId)
    setScaling({ id: n.id, scale: scaleOf(n) })
  }

  function onScaleMove(e: PointerEvent<HTMLDivElement>, n: ChainNode) {
    if (!scaling) return
    const s = scaleStart.current
    // Average the two axes so the shape stays a circle or diamond.
    const size = s.size + (e.clientX - s.x + e.clientY - s.y) / 2
    const scale = Math.min(SCALE_RANGE.max, Math.max(SCALE_RANGE.min, size / baseSize(n)))
    setScaling({ id: n.id, scale })
  }

  function onScaleUp() {
    if (!scaling) return
    actions.scaleNode(scaling.id, scaling.scale)
    setScaling(null)
  }

  /** Double-clicking bare background drops a text box there. */
  function onBackgroundDoubleClick(e: MouseEvent<HTMLDivElement>) {
    if (e.target !== innerRef.current) return
    const p = toCanvas(e.clientX, e.clientY)
    actions.addNote({ x: Math.max(0, p.x - 12), y: Math.max(0, p.y - 12) })
  }

  // --- pulling chains ---
  function onHandleDown(e: PointerEvent<HTMLDivElement>, from: string) {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setLinking({ from, end: toCanvas(e.clientX, e.clientY), over: null })
  }

  function onHandleMove(e: PointerEvent<HTMLDivElement>) {
    if (!linking) return
    const over = nodeAt(e.clientX, e.clientY)
    setLinking({ ...linking, end: toCanvas(e.clientX, e.clientY), over: over === linking.from ? null : over })
  }

  function onHandleUp(e: PointerEvent<HTMLDivElement>) {
    if (!linking) return
    const target = nodeAt(e.clientX, e.clientY)
    if (target && target !== linking.from) {
      const err = actions.addLink(linking.from, target)
      if (err) flash(err)
    }
    setLinking(null)
  }

  /** Chain color follows the effect it feeds or leaves; plain thing-to-thing chains are neutral. */
  const chainTone = (from: ChainNode, to: ChainNode) => {
    const effect = from.kind === 'effect' ? from : to.kind === 'effect' ? to : null
    if (!effect) return 'plain'
    return effect.effect === 'inhibits' ? 'neg' : 'pos'
  }

  const chains = graph.links.flatMap((l) => {
    const from = byId.get(l.from)
    const to = byId.get(l.to)
    if (!from || !to) return []
    const a = center(l.from)
    const b = center(l.to)
    const p = edgePoint(from, sizeOf(from), a, b)
    const q = edgePoint(to, sizeOf(to), b, a)
    return [{ link: l, p, q, mid: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, tone: chainTone(from, to) }]
  })

  const handle = (id: string) => (
    <div
      className="chain-handle"
      title="Drag onto another card to link them"
      onPointerDown={(e) => onHandleDown(e, id)}
      onPointerMove={onHandleMove}
      onPointerUp={onHandleUp}
      onPointerCancel={() => setLinking(null)}
    >
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M4 12h14M13 6l6 6-6 6" />
      </svg>
    </div>
  )

  const cardProps = (n: ChainNode, base: string) => ({
    'data-node-id': n.id,
    className: [base, (drag?.id === n.id || scaling?.id === n.id) && 'dragging', linking?.over === n.id && 'drop-target']
      .filter(Boolean)
      .join(' '),
    style: { left: pos.get(n.id)!.x, top: pos.get(n.id)!.y, width: sizeOf(n), height: sizeOf(n) },
    ...dragProps('node', n.id),
  })

  return (
    <section className="canvas">
      <div ref={innerRef} className="canvas-inner" style={{ width, height }} onDoubleClick={onBackgroundDoubleClick}>
        {empty && <p className="canvas-hint">Add a thing or an effect in the panel to start a chain, or double-click to add a text box.</p>}

        {graph.notes.map((note) => {
          const p = notePos.get(note.id)!
          const size = noteSize(note.id, note.size)
          return (
            <div
              key={note.id}
              className={drag?.id === note.id || resizing?.id === note.id ? 'note dragging' : 'note'}
              // The set height is a minimum: the box still grows if the text needs more room.
              style={{ left: p.x, top: p.y, width: size?.w ?? NOTE_W, minHeight: size?.h }}
              {...dragProps('note', note.id)}
            >
              <WrapField
                className="note-text"
                multiline
                value={note.text}
                placeholder="Type here"
                onChange={(v) => actions.setNoteText(note.id, v)}
              />
              <button className="icon-btn note-remove" onClick={() => actions.removeNote(note.id)} aria-label="Remove text box">
                ×
              </button>
              <div
                className="note-resize"
                title="Drag to resize"
                onPointerDown={(e) => onResizeDown(e, note.id)}
                onPointerMove={onResizeMove}
                onPointerUp={onResizeUp}
                onPointerCancel={onResizeUp}
              />
            </div>
          )
        })}

        <svg className="edges" width={width} height={height}>
          <defs>
            {['pos', 'neg', 'plain'].map((t) => (
              <marker
                key={t}
                id={`arrow-${t}`}
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="14"
                markerHeight="14"
                markerUnits="userSpaceOnUse"
                orient="auto"
              >
                <path d="M0,0 L10,5 L0,10 z" className={`chain-${t}-fill`} />
              </marker>
            ))}
          </defs>
          {chains.map(({ link, p, q, tone }) => (
            <line
              key={link.id}
              x1={p.x}
              y1={p.y}
              x2={q.x}
              y2={q.y}
              className={`chain chain-${tone}`}
              markerEnd={`url(#arrow-${tone})`}
            />
          ))}
          {linking && (() => {
            const from = byId.get(linking.from)!
            const c = center(linking.from)
            const p = edgePoint(from, sizeOf(from), c, linking.end)
            return (
              <line
                x1={p.x}
                y1={p.y}
                x2={linking.end.x}
                y2={linking.end.y}
                className="chain chain-plain chain-pending"
                markerEnd="url(#arrow-plain)"
              />
            )
          })()}
        </svg>

        {chains.map(({ link, mid }) => (
          <div key={link.id} className="chain-label" style={{ left: mid.x, top: mid.y }}>
            <input
              value={link.label ?? ''}
              placeholder="add text"
              size={Math.max(7, (link.label ?? '').length + 1)}
              onChange={(e) => actions.setLinkLabel(link.id, e.target.value)}
              aria-label="Chain text"
            />
            <button className="icon-btn" onClick={() => actions.removeLink(link.id)} aria-label="Remove chain">
              ×
            </button>
          </div>
        ))}

        {graph.nodes.map((n) => {
          const value = values.get(n.id) ?? n.base
          const fromInputs = influence(graph, values, n.id)
          const inhibits = n.kind === 'effect' && n.effect === 'inhibits'
          const locked = isLocked(graph, n.id)
          return (
            <div key={n.id} {...cardProps(n, n.kind === 'thing' ? 'thing' : `effect ${inhibits ? 'neg' : 'pos'}`)}>
              {n.kind === 'effect' && (
                <svg className="effect-shape" viewBox="0 0 100 100" aria-hidden>
                  <polygon points="50,1 99,50 50,99 1,50" />
                </svg>
              )}
              {/* Contents are laid out at the base size and scaled as one, so text, bar and handles all grow together. */}
              <div className="card-scale" style={{ width: baseSize(n), height: baseSize(n), transform: `scale(${scaleOf(n)})` }}>
                <button className="icon-btn card-remove" onClick={() => actions.removeNode(n.id)} aria-label="Remove">
                  ×
                </button>
                <div className="card-body">
                  <WrapField
                    value={n.label}
                    placeholder={n.kind === 'effect' ? 'name' : 'thing'}
                    onChange={(v) => actions.renameNode(n.id, v)}
                  />
                  {/* The bar is the control on a chain's starting card; on every later card it only shows the result. */}
                  <input
                    type="range"
                    disabled={locked}
                    title={locked ? 'Set by the cards chained into this one' : undefined}
                    className={inhibits ? 'level down' : 'level up'}
                    style={{ '--fill': `${value}%` } as CSSProperties}
                    min={0}
                    max={100}
                    value={Math.round(value)}
                    onChange={(e) => actions.setBase(n.id, Number(e.target.value) - fromInputs)}
                    aria-label={`${n.label || 'Effect'} level`}
                  />
                </div>
                {handle(n.id)}
              </div>
              <div
                className="scale-handle"
                title="Drag to scale"
                onPointerDown={(e) => onScaleDown(e, n)}
                onPointerMove={(e) => onScaleMove(e, n)}
                onPointerUp={onScaleUp}
                onPointerCancel={onScaleUp}
              />
            </div>
          )
        })}

        {notice && <div className="notice">{notice}</div>}
      </div>
    </section>
  )
}
