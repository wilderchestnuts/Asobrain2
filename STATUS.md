# Where this is

Updated 2026-08-06. Read `DECISIONS.md` for the product calls this implements.

Everything below is verified: `npx tsc --noEmit`, `npm run build` and
`npm test` (113 tests) all pass on the current commit.

## Done

**The engine is finished and tested.** All three rulesets, playable end to end.

| Area | State |
| --- | --- |
| Hex geometry, state contract, seeded RNG | Done |
| Board generation with balance constraints | Done |
| Seafarers scenarios (incl. **fog islands**) | Done |
| Base Catan rules | Done |
| Seafarers: ships, pirate, fog, island bonuses | Done |
| Cities & Knights: commodities, event die, barbarians, improvements, metropolises, knights, walls, progress cards | Done |
| Bots, with **trade rate limiting** | Done |
| Supabase schema, auth, API routes, realtime hooks | Written, **not yet run against a real Supabase project** |
| Board rendering + touch interaction | Done — see `/board-preview` |

The tests that matter most are the full-game runs: they play complete games
from fixed seeds and assert invariants after *every* applied action. They are
what caught the three real bugs fixed in the C&K commit.

## Not done

1. **The game screen.** `<Board>` exists and works, but nothing wires it to a
   live game yet — no turn UI, hand display, trade panel, knight controls,
   improvement tracks, or log. This is the biggest remaining piece.
2. **Lobby and game setup.** No screen to create a game, pick expansions, set
   the victory target, or add bots.
3. **Supabase has never been run.** The schema and routes are written but
   untested against a real project. Follow `docs/DEPLOYMENT.md` — expect to fix
   things on first contact.
4. **Progress cards are uneven.** All 24 are implemented and none can wedge a
   game, but several resolve as an immediate one-off payout rather than a
   lingering modifier (the trade-rate and build-discount cards especially).
   Marked with comments in `rules/citiesKnights.ts`. Worth revisiting once the
   game is playable, not before.
5. **No knight-vs-robber UI**, no ship-movement UI — the actions exist in the
   engine and are offered by `legalActions`, but nothing surfaces them.

## Resuming cheaply

```bash
npm install
npm test           # 113 tests, ~25s — confirms the engine still works
npm run dev        # then open /board-preview to see the board
```

The next session should start on the game screen, because it is what stands
between this and being playable. `legalActions(state, playerId)` already
returns every legal move for the current player, so the screen's job is to
render state and route taps back into it — not to know any rules.
