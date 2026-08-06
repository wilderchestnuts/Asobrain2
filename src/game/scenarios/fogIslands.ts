/**
 * Seafarers 5 — The Fog Islands.
 *
 * Two thin home islands with a bank of fog between them. A fog hex is water
 * you cannot see into: build a ship alongside it and it turns into whatever
 * was underneath — land, gold, or more open sea.
 *
 * The fog stack is shuffled per game, so the middle of the map is different
 * every time even though the coastlines are fixed.
 */

import {
  assembleBoard,
  numberTokens,
  type HexSpec,
  type Scenario,
} from '../board';
import type { Rng } from '../rng';
import type { Terrain } from '../types';
import { rows, row, SEAFARERS } from './common';

const ISLANDS = rows(
  // western home island
  row(-2, -3, 'fp'),
  row(-1, -4, 'gmh'),
  row(0, -4, 'pfg'),
  row(1, -4, 'hd'),
  // eastern home island
  row(-2, 2, 'gh'),
  row(-1, 2, 'pfm'),
  row(0, 1, 'hgp'),
  row(1, 1, 'fm'),
);

/** The fog bank, north to south down the middle of the map. */
const FOG: { q: number; r: number }[] = [
  { q: 0, r: -3 },
  { q: 1, r: -3 },
  { q: -1, r: -2 },
  { q: 0, r: -2 },
  { q: 1, r: -2 },
  { q: -1, r: -1 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
  { q: -1, r: 0 },
  { q: 0, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

/** What the fog can be hiding. Two tiles are simply more ocean. */
const FOG_STACK: Terrain[] = [
  'gold',
  'gold',
  'forest',
  'forest',
  'pasture',
  'pasture',
  'fields',
  'fields',
  'hills',
  'mountains',
  'sea',
  'sea',
];

function fogHexes(rng: Rng): HexSpec[] {
  const stack = rng.shuffle(FOG_STACK);
  const producing = stack.filter((t) => t !== 'sea').length;
  const tokens = rng.shuffle(numberTokens(producing));
  let next = 0;
  return FOG.map((coord, i) => {
    const terrain = stack[i];
    const hidden: { terrain: Terrain; number?: number } = { terrain };
    if (terrain !== 'sea') hidden.number = tokens[next++];
    return { ...coord, terrain: 'fog' as const, hidden };
  });
}

export const fogIslands: Scenario = {
  id: 'fog-islands',
  name: 'The Fog Islands',
  description:
    'Two home islands separated by fog. Ships reveal what lies in the mist — new land, gold, or nothing but sea.',
  minPlayers: 2,
  maxPlayers: 4,
  victoryPointsToWin: 13,
  expansions: SEAFARERS,
  islandBonus: { 1: 2, 2: 2, 3: 2 },
  build: (rng) =>
    assembleBoard([...ISLANDS, ...fogHexes(rng)], rng, {
      seaMargin: 2,
      ports: 9,
      seafarers: true,
    }),
};
