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
import { rows, row, SEAFARERS } from './common';
import { shroud } from './goldenFog';

// ---------------------------------------------------------------------------
// Six Islands — no home continent at all
// ---------------------------------------------------------------------------

/**
 * Six small islands and nothing else, so the very first road is a ship and
 * every expansion is a crossing. Landfall bonuses carry the scoring.
 */
const SIX = rows(
  row(-3, -1, 'fp'),
  row(-2, -2, 'hg'),

  row(-3, 2, 'gm'),
  row(-2, 2, 'pf'),

  row(0, -4, 'pd'),
  row(1, -4, 'gf'),

  row(0, 2, 'fh'),
  row(1, 2, 'mp'),

  row(3, -2, 'go'),
  row(4, -2, 'hp'),

  row(3, 1, 'mg'),
  row(4, 0, 'pf'),
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
    assembleBoard(SIX, rng, { seaMargin: 2, ports: 10, seafarers: true }),
};

// ---------------------------------------------------------------------------
// The Long Chain — a curving arc of islets
// ---------------------------------------------------------------------------

/**
 * A crescent of small islands with a wider foot. Expansion runs along the
 * chain rather than outward in all directions, so players meet each other
 * head-on instead of quietly filling separate corners.
 */
const CHAIN = rows(
  row(-3, 1, 'fp'),
  row(-2, 0, 'gh'),
  row(-1, -1, 'mf'),
  row(0, -2, 'pg'),
  row(1, -3, 'hd'),
  row(2, -4, 'gp'),
  row(3, -4, 'mh'),
  row(4, -5, 'fg'),
);

/** Two gold islets in fog, off the outside of the curve. */
const CHAIN_FOG = [
  { q: 2, r: -1 },
  { q: 3, r: -1 },
  { q: -1, r: 2 },
  { q: 0, r: 2 },
  { q: 4, r: -3 },
  { q: -3, r: 3 },
];

const CHAIN_STACK: Terrain[] = [
  'gold',
  'gold',
  'fields',
  'forest',
  'sea',
  'sea',
];

export const longChain: Scenario = {
  id: 'long-chain',
  name: 'The Long Chain',
  description:
    'A crescent of islets, with gold hidden in the fog off the outer edge. Everyone expands along the same arc, so the good spots are contested.',
  minPlayers: 2,
  maxPlayers: 4,
  victoryPointsToWin: 13,
  expansions: SEAFARERS,
  islandBonus: { 1: 2, 2: 2, 3: 2, 4: 2 },
  build: (rng) =>
    assembleBoard([...CHAIN, ...shroud(CHAIN_FOG, CHAIN_STACK, rng)], rng, {
      seaMargin: 2,
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
