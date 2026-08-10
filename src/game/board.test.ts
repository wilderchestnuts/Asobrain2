import { describe, expect, it } from 'vitest';

import {
  generateBoard,
  goldBudget,
  isLandTerrain,
  landTerrains,
  numberTokens,
  pipsFor,
  standardPortKinds,
} from './board';
import {
  edgeHexes,
  edgeVertices,
  hexEdges,
  hexKey,
  hexVertices,
  makeEdgeId,
  makeVertexId,
  neighbor,
  neighbors,
  parseHexKey,
  vertexEdges,
  vertexHexes,
  type HexCoord,
  type HexKey,
  type VertexId,
} from './hex';
import { Rng } from './rng';
import { SCENARIOS, boardForOptions, getScenario } from './scenarios';
import type { Board, GameOptions, Hex } from './types';
import { PRODUCING_TERRAINS } from './types';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const options = (over: Partial<GameOptions> = {}): GameOptions => ({
  expansions: { seafarers: false, citiesAndKnights: false },
  victoryPointsToWin: 10,
  scenario: 'random',
  boardRadius: 2,
  goldHexCount: 0,
  handLimit: 7,
  seed: 'test',
  turnTimeLimit: 0,
  friendlyRobber: false,
  ...over,
});

const boardFor = (seed: string, over: Partial<GameOptions> = {}): Board =>
  generateBoard(options(over), new Rng(seed));

const mapOf = (board: Board): Map<HexKey, Hex> =>
  new Map(board.hexes.map((h) => [hexKey(h.coord), h]));

const landHexes = (board: Board): Hex[] =>
  board.hexes.filter((h) => isLandTerrain(h.terrain));

/** Flood fill over hexes that satisfy `passable`, returning component sizes. */
function components(hexes: Hex[], passable: (h: Hex) => boolean): number[] {
  const map = new Map(hexes.map((h) => [hexKey(h.coord), h]));
  const seen = new Set<HexKey>();
  const sizes: number[] = [];
  for (const hex of hexes) {
    const start = hexKey(hex.coord);
    if (!passable(hex) || seen.has(start)) continue;
    let size = 0;
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const key = queue.pop() as HexKey;
      size++;
      for (const n of neighbors(parseHexKey(key))) {
        const nk = hexKey(n);
        const other = map.get(nk);
        if (!other || seen.has(nk) || !passable(other)) continue;
        seen.add(nk);
        queue.push(nk);
      }
    }
    sizes.push(size);
  }
  return sizes.sort((a, b) => b - a);
}

const SEEDS = Array.from({ length: 200 }, (_, i) => `board-${i}`);

// ---------------------------------------------------------------------------
// geometry
// ---------------------------------------------------------------------------

describe('hex geometry', () => {
  const board = boardFor('geometry');

  it('gives every hex six distinct vertices and six distinct edges', () => {
    for (const hex of board.hexes) {
      const vertices = hexVertices(hex.coord);
      const edges = hexEdges(hex.coord);
      expect(vertices).toHaveLength(6);
      expect(edges).toHaveLength(6);
      expect(new Set(vertices).size).toBe(6);
      expect(new Set(edges).size).toBe(6);
    }
  });

  it('gives every edge exactly two endpoints, each touching both its hexes', () => {
    for (const edge of [...board.roadEdges, ...board.shipEdges]) {
      const ends = edgeVertices(edge);
      expect(ends).toHaveLength(2);
      const [a, b] = edgeHexes(edge).map(hexKey);
      for (const end of ends) {
        const at = vertexHexes(end).map(hexKey);
        expect(at).toContain(a);
        expect(at).toContain(b);
        expect(vertexEdges(end)).toContain(edge);
      }
    }
  });

  it('round-trips vertex and edge ids through their hexes', () => {
    const a: HexCoord = { q: 1, r: -2 };
    for (let d = 0; d < 6; d++) {
      const b = neighbor(a, d);
      const c = neighbor(a, d + 1);

      const edge = makeEdgeId(a, b);
      expect(makeEdgeId(...(edgeHexes(edge) as [HexCoord, HexCoord]))).toBe(edge);
      expect(makeEdgeId(b, a)).toBe(edge);

      const vertex = makeVertexId(a, b, c);
      expect(makeVertexId(c, a, b)).toBe(vertex);
      const [x, y, z] = vertexHexes(vertex);
      expect(makeVertexId(x, y, z)).toBe(vertex);
      expect(vertexHexes(vertex).map(hexKey).sort()).toEqual(
        [a, b, c].map(hexKey).sort(),
      );
    }
  });

  it('lists a vertex on all three of its edges and vice versa', () => {
    for (const vertex of boardFor('geometry').landVertices.slice(0, 50)) {
      const edges = vertexEdges(vertex);
      expect(new Set(edges).size).toBe(3);
      for (const edge of edges) expect(edgeVertices(edge)).toContain(vertex);
    }
  });
});

describe('pipsFor', () => {
  it('counts probability dots', () => {
    expect([2, 3, 4, 5, 6].map(pipsFor)).toEqual([1, 2, 3, 4, 5]);
    expect([8, 9, 10, 11, 12].map(pipsFor)).toEqual([5, 4, 3, 2, 1]);
  });

  it('is zero for anything that cannot be rolled on a hex', () => {
    expect(pipsFor(7)).toBe(0);
    expect(pipsFor(0)).toBe(0);
    expect(pipsFor(13)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// supplies
// ---------------------------------------------------------------------------

describe('supplies', () => {
  it('uses the classic mix for a 19-hex island', () => {
    const counts = landTerrains(19).reduce<Record<string, number>>((acc, t) => {
      acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({
      forest: 4,
      pasture: 4,
      fields: 4,
      hills: 3,
      mountains: 3,
      desert: 1,
    });
  });

  it('scales the mix to bigger islands without losing hexes', () => {
    for (const n of [7, 19, 37, 61, 91]) {
      expect(landTerrains(n)).toHaveLength(n);
    }
    const big = landTerrains(61);
    expect(big.filter((t) => t === 'desert')).toHaveLength(3);
    expect(big.filter((t) => t === 'forest').length).toBeGreaterThan(
      big.filter((t) => t === 'hills').length,
    );
  });

  it('deals the standard token set for 18 producing hexes', () => {
    expect([...numberTokens(18)].sort((a, b) => a - b)).toEqual([
      2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12,
    ]);
  });

  it('never deals a 7 and scales past one set', () => {
    for (const n of [1, 5, 18, 19, 36, 47]) {
      const tokens = numberTokens(n);
      expect(tokens).toHaveLength(n);
      expect(tokens).not.toContain(7);
      expect(tokens.every((t) => t >= 2 && t <= 12)).toBe(true);
    }
  });

  it('mixes ports 4 generic to 5 specific', () => {
    const kinds = standardPortKinds(9);
    expect(kinds.filter((k) => k === 'any')).toHaveLength(4);
    expect(new Set(kinds.filter((k) => k !== 'any')).size).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// generated boards
// ---------------------------------------------------------------------------

describe('generateBoard', () => {
  it('is deterministic for a seed', () => {
    expect(boardFor('same')).toEqual(boardFor('same'));
    expect(boardFor('same')).not.toEqual(boardFor('different'));
  });

  it('builds the classic 19-hex island inside a ring of sea', () => {
    const board = boardFor('classic');
    expect(landHexes(board)).toHaveLength(19);
    expect(board.hexes.filter((h) => h.terrain === 'sea')).toHaveLength(18);
    expect(board.hexes.find((h) => h.terrain === 'desert')?.coord).toEqual(
      board.robber,
    );
    expect(board.pirate).toBeUndefined();
  });

  it('places the pirate in open water when seafarers is on', () => {
    const board = boardFor('sea', { expansions: { seafarers: true, citiesAndKnights: false } });
    const map = mapOf(board);
    expect(board.pirate).toBeDefined();
    expect(map.get(hexKey(board.pirate as HexCoord))?.terrain).toBe('sea');
  });

  it('caps gold by board size, however much is asked for', () => {
    // Gold pays any resource, so it is strictly stronger than an ordinary hex
    // on the same number. A classic 19-hex board can carry one without the
    // whole game collapsing onto it.
    const board = boardFor('gold', { goldHexCount: 3 });
    const gold = board.hexes.filter((h) => h.terrain === 'gold');
    expect(gold).toHaveLength(goldBudget(19));
    expect(gold.length).toBeLessThanOrEqual(1);
    for (const hex of gold) expect(hex.number).toBeDefined();
    expect(landHexes(board)).toHaveLength(19);
  });

  it('allows more gold on a bigger board', () => {
    expect(goldBudget(19)).toBe(1);
    expect(goldBudget(37)).toBe(3);
    expect(goldBudget(8)).toBe(0);
  });

  it('gives gold the least likely numbers on the board', () => {
    // Checked across many seeds because a single board could be a coincidence.
    for (let i = 0; i < 60; i++) {
      const board = boardFor(`gold-weak-${i}`, {
        goldHexCount: 4,
        boardRadius: 3,
      });
      const gold = board.hexes.filter((h) => h.terrain === 'gold');
      if (gold.length === 0) continue;

      const ordinary = board.hexes.filter(
        (h) =>
          h.terrain !== 'gold' &&
          h.terrain !== 'desert' &&
          h.number !== undefined,
      );
      const worstGold = Math.max(...gold.map((h) => pipsFor(h.number!)));
      const medianOrdinary =
        ordinary.map((h) => pipsFor(h.number!)).sort((a, b) => a - b)[
          Math.floor(ordinary.length / 2)
        ];
      // Never a 6 or an 8, and no stronger than a typical hex.
      expect(worstGold).toBeLessThan(5);
      expect(worstGold).toBeLessThanOrEqual(medianOrdinary);
    }
  });

  it('scales to larger radii', () => {
    for (const radius of [1, 3, 4]) {
      const board = boardFor(`r${radius}`, { boardRadius: radius });
      const expected = 3 * radius * radius + 3 * radius + 1;
      expect(landHexes(board)).toHaveLength(expected);
      expect(board.ports).toHaveLength(3 * (radius + 1));
    }
  });

  describe.each([
    ['classic', {}],
    ['gold', { goldHexCount: 2 }],
    ['big', { boardRadius: 3 }],
  ])('balance on 200 seeded boards (%s)', (label, over) => {
    const boards = SEEDS.map((seed) => boardFor(`${label}-${seed}`, over));

    it('numbers every producing hex and nothing else', () => {
      for (const board of boards) {
        for (const hex of board.hexes) {
          if (PRODUCING_TERRAINS.includes(hex.terrain)) {
            expect(hex.number).toBeDefined();
          } else {
            expect(hex.number).toBeUndefined();
          }
        }
      }
    });

    it('keeps 6 and 8 apart', () => {
      for (const board of boards) {
        const map = mapOf(board);
        for (const hex of board.hexes) {
          if (hex.number !== 6 && hex.number !== 8) continue;
          for (const n of neighbors(hex.coord)) {
            const other = map.get(hexKey(n))?.number;
            expect(other === 6 || other === 8).toBe(false);
          }
        }
      }
    });

    it('never stacks more than 13 pips on one vertex', () => {
      for (const board of boards) {
        const map = mapOf(board);
        for (const vertex of board.landVertices) {
          const pips = vertexHexes(vertex).reduce(
            (sum, h) => sum + pipsFor(map.get(hexKey(h))?.number ?? 0),
            0,
          );
          expect(pips).toBeLessThanOrEqual(13);
        }
      }
    });

    it('avoids three mutually adjacent hexes of one terrain', () => {
      for (const board of boards) {
        const map = mapOf(board);
        for (const hex of board.hexes) {
          if (!isLandTerrain(hex.terrain) || hex.terrain === 'desert') continue;
          for (let d = 0; d < 6; d++) {
            const a = map.get(hexKey(neighbor(hex.coord, d)));
            const b = map.get(hexKey(neighbor(hex.coord, d + 1)));
            const cluster =
              a?.terrain === hex.terrain && b?.terrain === hex.terrain;
            expect(cluster).toBe(false);
          }
        }
      }
    });

    it('deals exactly the scaled token supply', () => {
      const expected = [...numberTokens(
        boards[0].hexes.filter((h) => PRODUCING_TERRAINS.includes(h.terrain)).length,
      )].sort((a, b) => a - b);
      for (const board of boards) {
        const dealt = board.hexes
          .map((h) => h.number)
          .filter((n): n is number => n !== undefined)
          .sort((a, b) => a - b);
        expect(dealt).toEqual(expected);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// ports
// ---------------------------------------------------------------------------

describe('ports', () => {
  const boards = SEEDS.slice(0, 50).map((seed) => boardFor(`ports-${seed}`));

  it('places nine ports on a classic board, four of them generic', () => {
    for (const board of boards) {
      expect(board.ports).toHaveLength(9);
      expect(board.ports.filter((p) => p.kind === 'any')).toHaveLength(4);
      expect(board.ports.filter((p) => p.ratio === 2)).toHaveLength(5);
      expect(new Set(board.ports.filter((p) => p.kind !== 'any').map((p) => p.kind)).size).toBe(5);
    }
  });

  it('sits each port on a sea hex facing land, with two usable vertices', () => {
    for (const board of boards) {
      const map = mapOf(board);
      for (const port of board.ports) {
        expect(map.get(hexKey(port.hex))?.terrain).toBe('sea');
        expect(port.vertices).toHaveLength(2);
        for (const v of port.vertices) {
          expect(board.landVertices).toContain(v);
          expect(vertexHexes(v).map(hexKey)).toContain(hexKey(port.hex));
        }
        expect(port.ratio).toBe(port.kind === 'any' ? 3 : 2);
      }
    }
  });

  it('never lets two ports share a vertex', () => {
    for (const board of boards) {
      const used = new Set<VertexId>();
      for (const port of board.ports) {
        for (const v of port.vertices) {
          expect(used.has(v)).toBe(false);
          used.add(v);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// islands and buildable sets
// ---------------------------------------------------------------------------

describe('islands', () => {
  it('numbers a single land mass as island 0', () => {
    const board = boardFor('one-island');
    for (const hex of landHexes(board)) expect(hex.island).toBe(0);
    for (const hex of board.hexes.filter((h) => !isLandTerrain(h.terrain))) {
      expect(hex.island).toBeUndefined();
    }
  });

  it('flood-fills separate land masses and ranks the largest first', () => {
    const board = SCENARIOS['heading-for-new-shores'].build(new Rng('islands'));
    const groups = new Map<number, Hex[]>();
    for (const hex of landHexes(board)) {
      const list = groups.get(hex.island as number) ?? [];
      list.push(hex);
      groups.set(hex.island as number, list);
    }
    const sizes = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g.length);
    expect(sizes).toEqual([19, 3, 3, 2]);

    // every group is genuinely connected, and no two groups touch
    const map = mapOf(board);
    for (const hex of landHexes(board)) {
      for (const n of neighbors(hex.coord)) {
        const other = map.get(hexKey(n));
        if (other && isLandTerrain(other.terrain)) {
          expect(other.island).toBe(hex.island);
        }
      }
    }
    for (const [island, group] of groups) {
      expect(components(group, () => true)).toEqual([group.length]);
      expect(island).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('buildable sets', () => {
  const board = boardFor('sets', { expansions: { seafarers: true, citiesAndKnights: false } });
  const map = mapOf(board);

  it('lists every vertex that touches land, and only those', () => {
    const expected = new Set(landHexes(board).flatMap((h) => hexVertices(h.coord)));
    expect(new Set(board.landVertices)).toEqual(expected);
  });

  it('lets roads run on edges touching land and ships on edges touching water', () => {
    for (const edge of board.roadEdges) {
      const hexes = edgeHexes(edge).map((h) => map.get(hexKey(h)));
      expect(hexes.every(Boolean)).toBe(true);
      expect(hexes.some((h) => h && isLandTerrain(h.terrain))).toBe(true);
    }
    for (const edge of board.shipEdges) {
      const hexes = edgeHexes(edge).map((h) => map.get(hexKey(h)));
      expect(hexes.every(Boolean)).toBe(true);
      expect(hexes.some((h) => h && !isLandTerrain(h.terrain))).toBe(true);
    }
    // the coast belongs to both
    const coast = board.roadEdges.filter((e) => board.shipEdges.includes(e));
    expect(coast.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// scenarios
// ---------------------------------------------------------------------------

describe('scenarios', () => {
  it('exposes the seafarers presets plus random', () => {
    expect(Object.keys(SCENARIOS).sort()).toEqual([
      'four-islands',
      'fog-islands',
      'golden-fog',
      'heading-for-new-shores',
      'long-chain',
      'random',
      'six-islands',
      'split-continent',
      'the-great-crossing',
      'through-the-desert',
    ].sort());
    expect(getScenario('four-islands')?.name).toBe('Four Islands');
    expect(getScenario('nope')).toBeUndefined();
  });

  it.each(Object.keys(SCENARIOS))('%s builds a coherent board', (id) => {
    const scenario = SCENARIOS[id];
    expect(scenario.id).toBe(id);
    expect(scenario.minPlayers).toBeLessThanOrEqual(scenario.maxPlayers);
    expect(scenario.victoryPointsToWin).toBeGreaterThan(0);

    for (const seed of ['a', 'b', 'c']) {
      const board = scenario.build(new Rng(seed));
      const map = mapOf(board);
      const land = landHexes(board);

      expect(land.length).toBeGreaterThan(6);
      expect(map.get(hexKey(board.robber))?.terrain).toBe('desert');
      expect(board.landVertices.length).toBeGreaterThan(0);
      expect(board.roadEdges.length).toBeGreaterThan(0);
      expect(board.shipEdges.length).toBeGreaterThan(0);

      // no hex placed twice
      expect(new Set(board.hexes.map((h) => hexKey(h.coord))).size).toBe(
        board.hexes.length,
      );

      // every land hex is on a connected island, numbered from the largest down
      const islands = new Set(land.map((h) => h.island));
      expect(islands.has(0)).toBe(true);
      expect([...islands].sort((a, b) => (a as number) - (b as number))).toEqual(
        land.map((h) => h.island).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => (a as number) - (b as number)),
      );
      for (const island of islands) {
        const group = land.filter((h) => h.island === island);
        expect(components(group, () => true)).toEqual([group.length]);
      }

      for (const hex of land) {
        if (PRODUCING_TERRAINS.includes(hex.terrain)) {
          expect(hex.number).toBeDefined();
        } else {
          expect(hex.number).toBeUndefined();
        }
      }

      // one body of water, so ships can always get from A to B
      expect(
        components(board.hexes, (h) => !isLandTerrain(h.terrain)),
      ).toHaveLength(1);
    }
  });

  it.each(Object.keys(SCENARIOS).filter((id) => id !== 'random'))(
    '%s is a seafarers map with sailing room and island bonuses',
    (id) => {
      const scenario = SCENARIOS[id];
      const board = scenario.build(new Rng('seafarers'));
      expect(scenario.expansions.seafarers).toBe(true);
      expect(board.pirate).toBeDefined();
      expect(scenario.islandBonus).toBeDefined();
      for (const [island, points] of Object.entries(scenario.islandBonus ?? {})) {
        expect(Number(island)).toBeGreaterThan(0); // island 0 is home, never a bonus
        expect(points).toBeGreaterThan(0);
      }
      // gold is the carrot for sailing; in the fog it is hidden until revealed
      const gold = board.hexes.filter(
        (h) => h.terrain === 'gold' || h.hidden?.terrain === 'gold',
      );
      expect(gold.length).toBeGreaterThan(0);

      // Ports scale with coastline rather than being a flat nine. Nine was
      // right when every preset was a 19-hex island, but a map whose whole
      // point is a cramped home island cannot seat that many without a port on
      // nearly every corner — and ports must not share a vertex.
      const landCount = landHexes(board).length;
      expect(board.ports.length).toBeGreaterThanOrEqual(
        Math.min(9, Math.max(3, Math.floor(landCount / 2))),
      );
    },
  );

  it('hides a payload under every fog hex', () => {
    const board = SCENARIOS['fog-islands'].build(new Rng('fog'));
    const fog = board.hexes.filter((h) => h.terrain === 'fog');
    expect(fog.length).toBe(12);
    for (const hex of fog) {
      expect(hex.hidden).toBeDefined();
      expect(hex.number).toBeUndefined();
      expect(hex.island).toBeUndefined();
      const hidden = hex.hidden as { terrain: string; number?: number };
      if (PRODUCING_TERRAINS.includes(hidden.terrain as Hex['terrain'])) {
        expect(hidden.number).toBeDefined();
      } else {
        expect(hidden.number).toBeUndefined();
      }
      // fog is sailed into, not built on
      expect(board.shipEdges.some((e) => edgeHexes(e).some((h) => hexKey(h) === hexKey(hex.coord)))).toBe(true);
    }
    expect(fog.filter((h) => h.hidden?.terrain === 'gold')).toHaveLength(2);
  });

  it('separates the great crossing by open ocean', () => {
    const board = SCENARIOS['the-great-crossing'].build(new Rng('crossing'));
    const sizes = components(board.hexes, (h) => isLandTerrain(h.terrain));
    expect(sizes).toEqual([16, 11]);
  });

  it('keeps four islands equal', () => {
    const board = SCENARIOS['four-islands'].build(new Rng('four'));
    expect(components(board.hexes, (h) => isLandTerrain(h.terrain))).toEqual([
      7, 7, 7, 7,
    ]);
    expect(board.hexes.filter((h) => h.terrain === 'gold')).toHaveLength(4);
  });

  it('walls off the desert scenario with desert, not water', () => {
    const board = SCENARIOS['through-the-desert'].build(new Rng('desert'));
    const deserts = board.hexes.filter((h) => h.terrain === 'desert');
    expect(deserts).toHaveLength(4);
    for (const hex of deserts) expect(hex.island).toBe(0);
    expect(components(board.hexes, (h) => isLandTerrain(h.terrain))).toEqual([
      20, 3, 3, 3,
    ]);
  });

  it('picks the board for a game from its options', () => {
    expect(boardForOptions(options(), new Rng('opts'))).toEqual(
      generateBoard(options(), new Rng('opts')),
    );
    expect(
      boardForOptions(options({ scenario: 'four-islands' }), new Rng('opts')),
    ).toEqual(SCENARIOS['four-islands'].build(new Rng('opts')));
    // an id nobody recognises still yields a playable board
    expect(
      boardForOptions(options({ scenario: 'nonsense' }), new Rng('opts')).hexes,
    ).toHaveLength(37);
  });
});
