# Product decisions

Answers from the owner, 2026-08-06. These are settled unless revisited.

## Scope

**The deliverable is the full game — base + Seafarers + Cities & Knights integrated.**
Not a milestone to reach eventually. Plain Catan is not interesting to these
players ("we have played enough regular catan that it is pretty boring"), so
there is no value in shipping a base-only version early. Build the whole thing.

## Platform

**iPad first.** It is the primary device by a wide margin. Touch targets,
pan/zoom, no hover, no keyboard. See the UI section of CLAUDE.md — that section
is a requirement, not a style preference.

## Auth

**Email magic link** via Supabase Auth. No passwords. Accounts persist so game
history survives.

## Bots

Single default difficulty, deliberately **not very hard**. The point of the game
is the two humans playing each other; the bots are "random interference," not
opponents to be beaten. Do not over-invest in bot strength.

### Bot trading must be rate-limited

Called out specifically as the most annoying thing about Xplorers: bots
constantly spamming trade requests. Requirements:

- A **per-game cap** on how many trades a bot may propose, plus a
  **per-turn cap** of at most one.
- Bots must not re-offer a trade a human already rejected this turn, and should
  back off after repeated rejections rather than retrying.
- Prefer bank/port trades over pestering a human when the value is close.
- Both caps live in `GameOptions` so they are tunable without a code change.

The bar: a human should never feel nagged. When in doubt, the bot stays quiet.

## Maps

- **Random generated boards are enough.** No map editor — explicitly not wanted.
- **Fog islands are the favourite.** A main island plus outer islands whose
  contents are hidden until a ship reveals them. This is the single most-liked
  map type; make it good, and make fog work correctly with both expansions.
- Variety across generated maps matters more than replicating official layouts.

## Victory points

The target must be **configurable with a sensible floor and ceiling**, defaulting
per scenario (base 10, C&K 13, combined 14+) but overridable in game setup.

## What they loved about Xplorers — the north star

1. Unique maps
2. Easy to join and just play (setup friction is the enemy)
3. Gold mines
4. Cities & Knights + Seafarers integration

Point 2 deserves weight in every setup/lobby decision: fewest possible taps from
"open the link" to "playing."
