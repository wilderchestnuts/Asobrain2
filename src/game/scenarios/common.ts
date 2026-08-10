/**
 * Shared vocabulary for hand-placed scenario maps.
 *
 * Scenario layouts are written a row at a time, because that is how a hex map
 * reads on paper: a row is an axial `r`, a starting `q`, and one letter per
 * hex going east. `.` is a hole, which the sea fill in `board.ts` closes.
 */

import { DIRECTIONS, neighbor } from '../hex';
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

/**
 * The hexes at exactly `radius` from the origin, walked in order around the
 * ring, so that neighbouring entries are neighbouring hexes.
 *
 * Maps built as rings of islets are laid out by index rather than by hand:
 * "three hexes, skip one" is a statement that cannot be subtly wrong, whereas
 * a hand-written coordinate list can — and twice did — join two islands
 * together without anybody noticing.
 */
export function ring(radius: number): { q: number; r: number }[] {
  if (radius <= 0) return [{ q: 0, r: 0 }];
  const out: { q: number; r: number }[] = [];
  let h = { q: DIRECTIONS[4].q * radius, r: DIRECTIONS[4].r * radius };
  for (let d = 0; d < 6; d++) {
    for (let i = 0; i < radius; i++) {
      out.push(h);
      h = neighbor(h, d);
    }
  }
  return out;
}

/**
 * `count` groups of `size` consecutive hexes spaced evenly around a ring, with
 * at least one empty hex between each — so no two groups can touch.
 */
export function islets(
  radius: number,
  count: number,
  size: number,
): { q: number; r: number }[][] {
  const cells = ring(radius);
  const stride = Math.floor(cells.length / count);
  if (stride < size + 1) {
    throw new Error(`ring ${radius} cannot hold ${count} islets of ${size}`);
  }
  return Array.from({ length: count }, (_, g) =>
    Array.from({ length: size }, (_, i) => cells[(g * stride + i) % cells.length]),
  );
}

/** Paint a run of hexes with terrain letters, positionally. */
export const paint = (
  coords: { q: number; r: number }[],
  codes: string,
): HexSpec[] =>
  coords.map((c, i) => {
    const terrain = TERRAIN_CODES[codes[i] ?? codes[codes.length - 1]];
    if (!terrain) throw new Error(`unknown terrain code "${codes[i]}"`);
    return { ...c, terrain };
  });

export const SEAFARERS = { seafarers: true, citiesAndKnights: false } as const;
