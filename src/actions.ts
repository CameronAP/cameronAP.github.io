import type { EffectType } from './model'

type Point = { x: number; y: number }

/** Graph mutations owned by App and passed down to the views. */
export interface Actions {
  addThing(label: string): void
  addEffect(effect: EffectType): void
  renameNode(id: string, label: string): void
  setBase(id: string, base: number): void
  removeNode(id: string): void
  moveNode(id: string, pos: Point): void
  scaleNode(id: string, scale: number): void
  /** Returns an error message, or null on success. */
  addLink(from: string, to: string): string | null
  setLinkLabel(id: string, label: string): void
  removeLink(id: string): void
  /** Adds a text box at `pos`, or near the top-left of the canvas if omitted. */
  addNote(pos?: Point): void
  setNoteText(id: string, text: string): void
  moveNote(id: string, pos: Point): void
  resizeNote(id: string, size: { w: number; h: number }): void
  removeNote(id: string): void
  /** Clears all dragged node positions so every node returns to the automatic layout. Text boxes stay put. */
  autoArrange(): void
  loadExample(): void
  /** Overwrites src/example.json with the current canvas via the dev server. Resolves to whether it worked. */
  saveAsExample(): Promise<boolean>
  clear(): void
}
