/**
 * Shared vocabulary for hand-placed scenario maps.
 *
 * Scenario layouts are written a row at a time, because that is how a hex map
 * reads on paper: a row is an axial `r`, a starting `q`, and one letter per
 * hex going east. `.` is a hole, which the sea fill in `board.ts` closes.
 */

import type { HexSpec } from '../board';
import type { Terrain } from '../types';

export const TERRAIN_CODES: Record<string, Terrain> = {
  f: 'forest',
  p: 'pasture',
  g: 'fields',
  h: 'hills',
  m: 'mountains',
  d: 'desert',
  o: 'gold',
  s: 'sea',
  '?': 'fog',
};

/** One map row: `r`, the `q` of its first letter, then the terrain letters. */
export function row(r: number, q0: number, codes: string): HexSpec[] {
  const out: HexSpec[] = [];
  [...codes].forEach((code, i) => {
    if (code === '.' || code === ' ') return;
    const terrain = TERRAIN_CODES[code];
    if (!terrain) throw new Error(`unknown terrain code "${code}"`);
    out.push({ q: q0 + i, r, terrain });
  });
  return out;
}

export const rows = (...groups: HexSpec[][]): HexSpec[] => groups.flat();

export const SEAFARERS = { seafarers: true, citiesAndKnights: false } as const;
