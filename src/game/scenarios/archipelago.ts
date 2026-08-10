/**
 * Three maps whose *shapes* differ, not just their terrain.
 *
 * The first few scenarios all came out as one blob of land in a sea border,
 * so they played the same however the terrain was shuffled. Silhouette is
 * what makes a map memorable: a ring you sail around, a chain you work along,
 * a continent split by a channel.
 */

import { assembleBoard, type Scenario } from '../board';
import type { Terrain } from '../types';
import { islets, paint, ring, rows, row, SEAFARERS } from './common';
import { shroud } from './goldenFog';

// ---------------------------------------------------------------------------
// Six Islands — no home continent at all
// ---------------------------------------------------------------------------

/**
 * Six small islands and nothing else, so the very first road is a ship and
 * every expansion is a crossing. Landfall bonuses carry the scoring.
 *
 * Each is a 2×2 rhombus and every pair is at least two hexes apart, so no two
 * can merge into one landmass — which they quietly did in the first version of
 * this map, leaving five islands under a name that promised six.
 */
const SIX = rows(
  row(-4, -1, 'fp'),
  row(-3, -1, 'hg'),

  row(-4, 3, 'gm'),
  row(-3, 3, 'op'),

  row(0, -4, 'pd'),
  row(1, -4, 'fg'),

  row(0, 3, 'mh'),
  row(1, 3, 'of'),

  row(4, -3, 'hg'),
  row(5, -3, 'pm'),

  row(4, 1, 'of'),
  row(5, 1, 'gh'),
);

export const sixIslands: Scenario = {
  id: 'six-islands',
  name: 'Six Islands',
  description:
    'No mainland — six small islands scattered across open water. Everything is reached by ship, and settling each new island pays.',
  minPlayers: 2,
  maxPlayers: 4,
  victoryPointsToWin: 14,
  expansions: SEAFARERS,
  islandBonus: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2 },
  build: (rng) =>
    assembleBoard(SIX, rng, { seaMargin: 1, ports: 10, seafarers: true }),
};

// ---------------------------------------------------------------------------
// The Long Chain — a curving arc of islets
// ---------------------------------------------------------------------------

/**
 * Five three-hex islets strung around most of a wide ring, leaving the sixth
 * position open — a crescent with a mouth rather than a closed atoll.
 *
 * Expansion runs *along* the chain rather than outward in all directions, so
 * players meet head-on instead of quietly filling separate corners, and every
 * link has to be sailed to. Laid out by ring index because the first version
 * of this was written out by hand and quietly fused into one fifteen-hex arc:
 * a chain in name only.
 */
const LINKS = islets(4, 6, 3).slice(0, 5);

const CHAIN = rows(
  paint(LINKS[0], 'fpg'),
  paint(LINKS[1], 'hdg'),
  paint(LINKS[2], 'mfp'),
  paint(LINKS[3], 'gph'),
  paint(LINKS[4], 'hgm'),
);

/**
 * The lagoon inside the ring is fogged, so the shortest way across the map is
 * also the one nobody can see into. Alternating positions, so no two fog hexes
 * touch and each has to be reached on its own.
 */
const CHAIN_FOG = ring(2).filter((_, i) => i % 2 === 0);

const CHAIN_STACK: Terrain[] = [
  'gold',
  'gold',
  'gold',
  'fields',
  'forest',
  'sea',
];

export const longChain: Scenario = {
  id: 'long-chain',
  name: 'The Long Chain',
  description:
    'Five islets strung around an open crescent, with a fogged lagoon in the middle of it. Everyone expands along the same arc, so the good spots are contested — and the gold is in the water nobody can see into.',
  minPlayers: 2,
  maxPlayers: 4,
  victoryPointsToWin: 13,
  expansions: SEAFARERS,
  islandBonus: { 1: 2, 2: 2, 3: 2, 4: 2 },
  build: (rng) =>
    assembleBoard([...CHAIN, ...shroud(CHAIN_FOG, CHAIN_STACK, rng)], rng, {
      seaMargin: 1,
      ports: 9,
      seafarers: true,
    }),
};

// ---------------------------------------------------------------------------
// The Split Continent — one landmass, one channel
// ---------------------------------------------------------------------------

/**
 * A single large continent cut in two by a navigable channel. Plenty of land,
 * so it plays closest to base Catan — but the far bank is only reachable by
 * ship, and that is where the gold is.
 */
const WEST = rows(
  row(-2, -3, 'fpg'),
  row(-1, -4, 'hmfp'),
  row(0, -4, 'gdhm'),
  row(1, -4, 'pgf'),
  row(2, -3, 'hp'),
);

const EAST = rows(
  row(-2, 1, 'ogf'),
  row(-1, 1, 'phm'),
  row(0, 1, 'fgo'),
  row(1, 1, 'mph'),
  row(2, 0, 'gf'),
);

export const splitContinent: Scenario = {
  id: 'split-continent',
  name: 'The Split Continent',
  description:
    'One big landmass divided by a channel. The eastern bank holds the gold and can only be reached by sea.',
  minPlayers: 2,
  maxPlayers: 4,
  victoryPointsToWin: 14,
  expansions: SEAFARERS,
  islandBonus: { 1: 3 },
  build: (rng) =>
    assembleBoard([...WEST, ...EAST], rng, {
      seaMargin: 2,
      ports: 10,
      seafarers: true,
    }),
};
