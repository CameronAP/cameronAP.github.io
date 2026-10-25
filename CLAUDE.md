# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ChainVisual is a React app for building **effect chains**. *Things* (circles, each with a level bar) and *effects* (diamonds, such as "inhibits" or "increases") are added independently, then linked by dragging a **chain** from one card's handle onto another card. A chain can carry a text label. For example, Myostatin ● → ◆ inhibits ◆ → ● Muscle growth. Effects pass amounts one-to-one. Changing a level propagates downstream, and several chains can feed into one card.

Stack: Vite + React 19 + TypeScript, oxlint. No other runtime dependencies. The project has no tests, by the owner's choice; don't add any.

## Commands

- `npm run dev` — start the dev server
- `npm run build` — type-check (`tsc -b`) and build into `dist/`
- `npm run lint` — oxlint (config in `.oxlintrc.json`)

## Architecture

- **`src/model.ts`** holds all of the domain logic as pure functions (no React). A `Graph` is `{ nodes, links }`, where `nodes` is a union discriminated by `kind`:
  - Things and effects share every field (`label`, `base`, `pos`) and behave the same way in the UI: a name, a draggable level bar, and a chain handle. Cards show no numbers. The only difference is the shape.
  - An `EffectNode` adds `effect: 'increases' | 'inhibits'`. There is no strength multiplier.
  - A `Link` is a plain chain with an optional `label`, and it passes its signal through unchanged.
  - `Graph.notes` holds free text boxes on the canvas background: `{ id, text, pos, size? }`. `size` comes from the corner resize handle; its height is a minimum, so a box still grows to fit its text. They are annotation only, take no part in propagation, and are left alone by Auto-arrange.
- **Propagation rule** (`computeValues`): every node gets `value = clamp(base + Σ incoming signal)`, in topological order. A node's *signal* is its value, negated for an inhibiting effect.
  - This is one-to-one with absolute amounts, and there is no neutral midpoint. Myostatin at 30 → inhibits (30) → Muscle growth loses 30, and at 0 it removes nothing.
  - New effects start at `base` 0 so they pass their input through exactly.
- **Locked bars**: only a chain's starting cards (no incoming links, `isLocked`) have an editable bar. Every other bar is a disabled range input that only shows the result. When `addLink` joins two cards, every node in the joined chain (`connectedIds`) has its `base` reset to `DEFAULT_BASE` (50 for things, 0 for effects).
- **Level bar**: on a starting card, the bar is itself the control (a styled range input), on circles and diamonds alike. Dragging it sets `base = target − influence(...)`, so the shown value lands where it was dropped, which means a `base` can go outside 0–100.
- **The graph must stay acyclic.** `computeValues` throws if it finds a cycle. Every path that adds a link must check `wouldCreateCycle` first, as `App.addLink` does. Any new feedback-loop feature would need a different propagation model, such as iterating until values settle.
- **State** lives in `App.tsx` as one `Graph`. Every run starts from `exampleGraph` (`src/example.json`, loaded through `migrate`), and edits are not persisted: there is no `localStorage`. `migrate()` still upgrades older graph formats. In v1, links carried a `weight`; each becomes an effect node plus two chains. In v2, effect nodes had a `weight`; it becomes an `effect` type with `base` 0. Graphs without a `notes` list get an empty one. Mutations are passed to children as an `Actions` object, typed in `src/actions.ts`. Displayed values are always derived (`useMemo` over `computeValues`) and never stored.
- **Sidebar is hidden**: `components/Sidebar.tsx` is no longer rendered, at the owner's request. It still holds the add-thing, add-effect and add-text-box forms, Auto-arrange, Load example, Clear, and Save as example. Re-render it in `App.tsx` to bring those back. "Save as example" POSTs the graph to `/__save-example`, a dev-only middleware in `vite.config.ts` that overwrites `src/example.json`.
- **Layout** (`components/GraphView.tsx`) has no layout library and does not measure the DOM. A node with a saved `pos` is drawn there. Any other node gets an automatic slot: its column comes from `depths()` (the longest path from a source), its row is its order within that column, and an effect is centered in its slot. Shapes have base sizes (`THING_D`, and the larger `EFFECT_D`, so the same controls fit inside a diamond), multiplied by an optional per-node `scale` (0.5–3) set by the card's scale handle. A card's contents sit in a `.card-scale` wrapper that is laid out at the base size and CSS-transformed, so everything scales together. Use `sizeOf(n)` (scaled) for geometry and `baseSize(n)` for inner layout, so chain endpoints are computed from the constants with `edgePoint` (a circle or diamond outline).
- **Pointer interactions** in `GraphView`:
  - Dragging a card or text box moves it (shared `drag` state with a `kind`); text boxes are dragged by their padding. Presses that start on inputs, text fields, buttons or the chain handle are ignored. The live position stays in local `drag` state, and `moveNode` or `moveNote` is called only on release.
  - Dragging a card's `.chain-handle` pulls out a pending chain. On release, `elementFromPoint` plus `closest('[data-node-id]')` finds the target card, and `addLink` returns an error string (duplicate, loop), which is shown as a toast.
  - Double-clicking bare background (the target must be `.canvas-inner` itself) adds a text box at that point.
- **Styling** is in `src/index.css`, using CSS variables on `:root` and a dark-mode override through `prefers-color-scheme`.
  - Circles and diamonds are white in both themes: `.thing, .effect` redefine the color variables with their light values.
  - Chains are plain SVG arrows (`<line>` with a marker). Each takes its color from the effect it touches: green for increases, red for inhibits, gray for a thing → thing chain.
