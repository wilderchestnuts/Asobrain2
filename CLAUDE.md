# Asobrain2 — a Catan clone with Seafarers + Cities & Knights

A spiritual successor to Xplorers on AsoBrain Games. Two humans (phones/iPads/desktop)
plus computer players, hosted on Vercel.

## Stack

- **Next.js 16** (App Router) + React 19 + TypeScript, deployed to Vercel
- **Tailwind v4** for styling
- **Supabase** for Postgres (game state), Realtime (push), and Auth
- **Vitest** for tests
- Board rendered as **inline SVG** — no canvas, no game engine library

## Architecture

The game is **server-authoritative**. Clients never compute state; they send
actions and render what comes back.

```
client → POST /api/games/[id]/action → validate session
                                     → load GameState from Postgres
                                     → applyAction(state, action)
                                     → run bot turns to completion
                                     → persist + bump version
                                     → broadcast via Supabase Realtime
                                     → all clients re-render
```

### `src/game/` — the pure engine

No React, no network, no I/O. Everything here is a pure function of
`(GameState, GameAction) → GameState`, which is what makes the rules testable
and the server able to verify rather than trust.

| File | Role |
| --- | --- |
| `hex.ts` | Pointy-top axial grid. Vertex/edge ids are **structural**: an edge is its two hexes sorted, a vertex is its three hexes sorted. No float keys. |
| `types.ts` | The whole state contract, covering all three rulesets. |
| `actions.ts` | The action union — the only input to the reducer. |
| `rng.ts` | Seeded, cursor-based randomness. The cursor lives in state, so games replay exactly. |
| `hand.ts` | Resource/commodity bag arithmetic. |
| `board.ts` | Board generation and scenario presets. |
| `reducer.ts` | `applyAction` — dispatches to the rules modules. |
| `rules/` | `base.ts`, `seafarers.ts`, `citiesKnights.ts` |
| `ai/` | Bot decision-making, also pure. |

### Invariants

1. **`GameState` is JSON.** No Maps, Sets, class instances, or functions. It is
   stored as JSONB and sent over the wire verbatim.
2. **The reducer never mutates and never throws for rule violations.** Illegal
   actions return `{ ok: false, error }` so the API can reject them cleanly.
3. **All randomness goes through `Rng`** seeded from `state.options.seed`, and
   advances `state.rngCursor`. Never call `Math.random()` in `src/game/`.
4. **Expansion fields are optional** and only populated when the matching flag
   in `options.expansions` is set. Base-game code must never assume they exist.
5. **Hidden information stays server-side.** Other players' hands and dev cards
   are stripped before the state is sent to a client — see `redact.ts`.

## UI: iPad first

This is played on an iPad more than anything else. That is a design
constraint, not a nice-to-have:

- **Tap targets ≥ 44px.** Vertex and edge hit areas are invisible circles much
  larger than the drawn piece.
- **No hover-dependent UI.** Anything reachable only by hover is unreachable.
  Use tap-to-select, tap-again-to-confirm.
- **The board pans and zooms** with one- and two-finger gestures, and never
  relies on the browser's own pinch-zoom.
- **Landscape and portrait both work.** Assume 1180×820 and 820×1180.
- **No layout shift from the on-screen keyboard**, and no text inputs during play.
- `touch-action` is managed explicitly; `user-select: none` on the board.

## Commands

```bash
npm run dev        # local dev server
npm run build      # production build (must pass before pushing)
npm test           # vitest
npx tsc --noEmit   # typecheck (must pass before pushing)
```

## Conventions

- Comments explain *why*, not *what*. Skip them when the code already says it.
- Prefer pure functions and plain data over classes.
- Keep expansion rules in their own module rather than branching inside base rules.
