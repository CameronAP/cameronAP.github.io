// Core data model and propagation logic. Pure functions only — no React here.

import exampleJson from './example.json'

export const MIN = 0
export const MAX = 100
/** Starting bar level for new cards, and what a chain's cards revert to when they are linked. */
export const DEFAULT_BASE = { thing: 50, effect: 0 } as const

type Point = { x: number; y: number }

export type EffectType = 'increases' | 'inhibits'

interface BaseNode {
  id: string
  label: string
  /** User-set level. With no inputs this is the value; otherwise inputs add to or subtract from it. */
  base: number
  /** Canvas position set by dragging. Absent means auto-laid-out. */
  pos?: Point
  /** Size multiplier set by the card's scale handle. Absent means 1. */
  scale?: number
}

/** A quantity, drawn as a circle. Passes its level downstream as-is. */
export interface ThingNode extends BaseNode {
  kind: 'thing'
}

/** A transform, drawn as a diamond. Has a level like a thing, but passes it on as a raise or a cut. */
export interface EffectNode extends BaseNode {
  kind: 'effect'
  effect: EffectType
}

export type ChainNode = ThingNode | EffectNode

/** A plain connection ("chain") between two nodes. It carries its source's signal unchanged. */
export interface Link {
  id: string
  from: string
  to: string
  label?: string
}

/** Free text placed on the canvas background. Purely annotation; it takes no part in propagation. */
export interface Note {
  id: string
  text: string
  pos: Point
  /** Set by dragging the resize handle. Absent means the default width and a height that fits the text. */
  size?: { w: number; h: number }
}

export interface Graph {
  nodes: ChainNode[]
  links: Link[]
  notes: Note[]
}

const clamp = (v: number) => Math.min(MAX, Math.max(MIN, v))

/**
 * Kahn's algorithm. Returns node ids in dependency order, or null if the graph has a cycle.
 */
export function topoOrder(graph: Graph): string[] | null {
  const indegree = new Map(graph.nodes.map((n) => [n.id, 0]))
  for (const l of graph.links) indegree.set(l.to, (indegree.get(l.to) ?? 0) + 1)

  const queue = graph.nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id)
  const order: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    order.push(id)
    for (const l of graph.links) {
      if (l.from !== id) continue
      const d = indegree.get(l.to)! - 1
      indegree.set(l.to, d)
      if (d === 0) queue.push(l.to)
    }
  }
  return order.length === graph.nodes.length ? order : null
}

/** What a node sends down each outgoing chain: its level, negated for an inhibiting effect. */
function signal(node: ChainNode, value: number): number {
  return node.kind === 'effect' && node.effect === 'inhibits' ? -value : value
}

/** Sum of the signals arriving at `id` over its incoming chains. */
export function influence(graph: Graph, values: Map<string, number>, id: string): number {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  let sum = 0
  for (const l of graph.links) {
    const from = byId.get(l.from)
    if (l.to === id && from) sum += signal(from, values.get(l.from) ?? from.base)
  }
  return sum
}

/**
 * Computes every node's level, in topological order. Things and effects work the same way:
 *   value = clamp(base + Σ incoming signal)
 * One-to-one: Myostatin at 30 → inhibits (30) → Muscle growth loses 30. At 0 it removes nothing.
 */
export function computeValues(graph: Graph): Map<string, number> {
  const order = topoOrder(graph)
  if (!order) throw new Error('Graph contains a cycle')

  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const values = new Map<string, number>()
  for (const id of order) {
    values.set(id, clamp(byId.get(id)!.base + influence(graph, values, id)))
  }
  return values
}

/** Only a chain's starting cards (no incoming links) have a bar the user can set; the rest follow their inputs. */
export function isLocked(graph: Graph, id: string): boolean {
  return graph.links.some((l) => l.to === id)
}

/** Ids of every node connected to `id` through links in either direction, including `id`. */
export function connectedIds(graph: Graph, id: string): Set<string> {
  const seen = new Set<string>()
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()!
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const l of graph.links) {
      if (l.from === cur) stack.push(l.to)
      if (l.to === cur) stack.push(l.from)
    }
  }
  return seen
}

/** True if adding from → to would make the graph cyclic (including self-links). */
export function wouldCreateCycle(graph: Graph, from: string, to: string): boolean {
  if (from === to) return true
  // A cycle forms iff `from` is already reachable from `to`.
  const stack = [to]
  const seen = new Set<string>()
  while (stack.length) {
    const id = stack.pop()!
    if (id === from) return true
    if (seen.has(id)) continue
    seen.add(id)
    for (const l of graph.links) if (l.from === id) stack.push(l.to)
  }
  return false
}

/** Column index for layout: longest path from any source node. */
export function depths(graph: Graph): Map<string, number> {
  const order = topoOrder(graph) ?? graph.nodes.map((n) => n.id)
  const depth = new Map<string, number>()
  for (const id of order) {
    let d = 0
    for (const l of graph.links) {
      if (l.to === id) d = Math.max(d, (depth.get(l.from) ?? 0) + 1)
    }
    depth.set(id, d)
  }
  return depth
}

/**
 * Upgrades graphs saved by earlier versions:
 * - v1: nodes had no `kind`, and each link carried a `weight` (the effect lived on the link).
 * - v2: effect nodes had a signed `weight` and no level of their own.
 * Both become effect nodes with an `effect` type and a base of 0, so they pass their input one-to-one.
 * Saves from before text boxes existed get an empty `notes` list.
 */
export function migrate(raw: unknown): Graph {
  const g = raw as { nodes?: Record<string, unknown>[]; links?: Record<string, unknown>[]; notes?: Note[] } | null
  if (!Array.isArray(g?.nodes) || !Array.isArray(g?.links)) return { nodes: [], links: [], notes: [] }

  const toEffect = (id: string, weight: number, pos: unknown): EffectNode => ({
    id,
    kind: 'effect',
    effect: weight < 0 ? 'inhibits' : 'increases',
    label: '',
    base: DEFAULT_BASE.effect,
    pos: pos as Point | undefined,
  })

  const nodes: ChainNode[] = g.nodes.map((n) => {
    if (n.kind === 'effect' && typeof n.weight === 'number') return toEffect(n.id as string, n.weight, n.pos)
    return (n.kind ? n : { ...n, kind: 'thing' }) as unknown as ChainNode
  })
  const links: Link[] = []
  for (const l of g.links) {
    if (typeof l.weight !== 'number') {
      links.push(l as unknown as Link)
      continue
    }
    const effectId = `e-${l.id}`
    nodes.push(toEffect(effectId, l.weight, l.pos))
    links.push({ id: `${l.id}-in`, from: l.from as string, to: effectId })
    links.push({ id: `${l.id}-out`, from: effectId, to: l.to as string })
  }
  return { nodes, links, notes: Array.isArray(g.notes) ? g.notes : [] }
}

/** The built-in example, stored in `example.json` so the app's "Save as example" button can overwrite it in dev. */
export const exampleGraph: Graph = migrate(exampleJson)
