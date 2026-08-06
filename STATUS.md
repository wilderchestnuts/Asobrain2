# Where this is

Updated 2026-08-06. Read `DECISIONS.md` for the product calls this implements.

Verified on the current commit: `npx tsc --noEmit`, `npm run build`, and
`npm test` (114 tests) all pass, and a two-player game has been played through
a real browser.

## The game is playable

Two people on two devices can start a game, join by link, and play Catan with
Seafarers and Cities & Knights against each other plus bots.

| Area | State |
| --- | --- |
| Hex geometry, state contract, seeded RNG | Done |
| Board generation with balance constraints | Done |
| Seafarers scenarios (incl. **fog islands**) | Done |
| Base Catan rules | Done |
| Seafarers: ships, pirate, fog, island bonuses | Done |
| Cities & Knights: commodities, event die, barbarians, improvements, metropolises, knights, walls, progress cards | Done |
| Bots, with **trade rate limiting** | Done |
| Board rendering + touch interaction | Done |
| Lobby, waiting room, game screen, trading | Done |
| Supabase schema, auth, API routes, realtime | Written; **runs in local JSON mode**, never run against a real Supabase project |

## How to try it

```bash
npm install
npm run dev        # http://localhost:3000
```

With no environment variables set it runs in local mode: no accounts, games in
a JSON file under `.asobrain/`, playable across two browser windows on the same
machine. That is enough to see the whole game working.

`/board-preview` renders the board standalone with every scenario, for looking
at map generation without starting a game.

## Not done

1. **Supabase has never been run.** Everything is written — schema, RLS, magic
   link auth, realtime — but untested against a real project. This is the one
   remaining step before you can play from two different devices over the
   internet. Follow `docs/DEPLOYMENT.md` and expect to fix things on first
   contact.
2. **Progress cards are uneven.** All 24 are implemented and none can wedge a
   game, but several resolve as an immediate one-off payout rather than a
   lingering modifier — the trade-rate and build-discount cards especially.
   Marked with comments in `rules/citiesKnights.ts`.
3. **Knight movement and ship relocation are reachable but clumsy.** Both are
   in the Cards & knights sheet as a flat list of destinations rather than
   being picked on the board.
4. **No reconnect indicator.** If realtime drops, the four-second poll covers
   it, but nothing tells you that is what happened.
5. **No sound, no animation** beyond the pulsing legal-move markers.

## Notes for whoever picks this up

The engine is the trustworthy part: it is pure, seeded, and covered by tests
that play complete games and assert invariants after every action. Those tests
have caught every real rules bug so far — a phase that never resolves, an
action `legal.ts` offers that the rules then refuse, a trade that hangs the
table. When adding a rule, add it to a module under `rules/` and let the
full-game tests find the interactions.

The UI knows no rules. `legalActions(state, playerId)` decides what is tappable
and every tap posts an action the server re-validates, so the screen cannot
disagree with the engine.
