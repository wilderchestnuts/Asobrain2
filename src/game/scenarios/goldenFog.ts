/**
 * Golden Fog — the map the owners asked for by name.
 *
 * One cramped home island, and everything else hidden in fog. The outer ring
 * is entirely unexplored: the only way to find out where the gold is, is to
 * build a ship and look. Roughly a third of the fog is gold, so exploring is
 * usually worth it — and because the stack is shuffled every game, no two
 * runs reward the same direction.
 *
 * Deliberately short of land at home. If the island were comfortable nobody
 * would ever put to sea, which is the whole point of the map.
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

/** A tight home island: enough to start, nowhere near enough to win. */
const HOME = rows(
  row(-1, 0, 'fpg'),
  row(0, -2, 'fhdg'),
  row(1, -1, 'mph'),
  row(2, -2, 'gp'),
);

/**
 * Four fog banks, one off each shoulder, sitting two rings out.
 *
 * The open water between them and the shore is not decoration: ports need a
 * stretch of real coast to sit on, and with the fog pressed against the island
 * there was nowhere to put them. It also gives ships somewhere to manoeuvre.
 */
const FOG: { q: number; r: number }[] = [
  // north
  { q: 0, r: -3 },
  { q: 1, r: -3 },
  { q: 2, r: -3 },
  // east
  { q: 3, r: -2 },
  { q: 3, r: -1 },
  { q: 3, r: 0 },
  // south
  { q: 0, r: 3 },
  { q: -1, r: 3 },
  { q: -2, r: 3 },
  // west
  { q: -3, r: 0 },
  { q: -3, r: 1 },
  { q: -3, r: 2 },
];

/**
 * What the fog hides. A third of it is gold, so opening a bank is usually
 * worth the ships — but a quarter is just more ocean, so it is never a
 * certainty. Shuffled per game, so no two runs reward the same direction.
 */
const FOG_STACK: Terrain[] = [
  'gold',
  'gold',
  'gold',
  'gold',
  'forest',
  'pasture',
  'fields',
  'hills',
  'mountains',
  'sea',
  'sea',
  'sea',
];

export function shroud(coords: { q: number; r: number }[], stack: Terrain[], rng: Rng): HexSpec[] {
  const shuffled = rng.shuffle(stack);
  const producing = shuffled.filter((t) => t !== 'sea' && t !== 'desert').length;
  const tokens = rng.shuffle(numberTokens(producing));
  let next = 0;
  return coords.map((coord, i) => {
    const terrain = shuffled[i % shuffled.length];
    const hidden: { terrain: Terrain; number?: number } = { terrain };
    if (terrain !== 'sea' && terrain !== 'desert') {
      hidden.number = tokens[next++ % tokens.length];
    }
    return { ...coord, terrain: 'fog' as const, hidden };
  });
}

export const goldenFog: Scenario = {
  id: 'golden-fog',
  name: 'Golden Fog',
  description:
    'A cramped home island ringed by fog. A third of what is out there is gold — but you have to sail into the mist to find out which third.',
  minPlayers: 2,
  maxPlayers: 4,
  victoryPointsToWin: 14,
  expansions: SEAFARERS,
  islandBonus: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2 },
  build: (rng) =>
    assembleBoard([...HOME, ...shroud(FOG, FOG_STACK, rng)], rng, {
      seaMargin: 2,
      ports: 9,
      seafarers: true,
    }),
};
