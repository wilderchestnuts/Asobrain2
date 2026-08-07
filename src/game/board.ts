/**
 * Board generation, and the scaffolding the scenario presets share.
 *
 * Two things here are worth knowing up front:
 *
 * 1. Balance beats raw randomness. Xplorers never handed one player a vertex
 *    with three red numbers on it, so terrain and number tokens are shuffled
 *    under constraints and re-rolled. The constraints are dropped in stages
 *    when a layout resists, which keeps generation bounded — it must always
 *    terminate, on any seed, for any board size.
 *
 * 2. Scenarios hand-place terrain and let this module do everything else:
 *    surround the land with sea, hand out number tokens, flood-fill islands,
 *    place ports and derive the buildable vertex/edge sets. `assembleBoard` is
 *    that seam.
 *
 * Fog hexes count as water until they are revealed: they are shippable, they
 * hold no number, and they do not join an island.
 */

import type { EdgeId, HexCoord, HexKey, VertexId } from './hex';
import {
  edgeHexes,
  edgeVertices,
  hexEdges,
  hexKey,
  hexSpiral,
  hexToPixel,
  hexVertices,
  makeEdgeId,
  neighbor,
  neighbors,
  parseHexKey,
  vertexHexes,
} from './hex';
import type { Rng } from './rng';
import type {
  Board,
  GameOptions,
  Hex,
  Port,
  PortKind,
  Terrain,
} from './types';
import { PRODUCING_TERRAINS, RESOURCES } from './types';

// ---------------------------------------------------------------------------
// Probability dots
// ---------------------------------------------------------------------------

/** Dots under a number token: 2/12 = 1 … 6/8 = 5. Anything unrollable is 0. */
export const pipsFor = (n: number): number =>
  n < 2 || n > 12 || n === 7 ? 0 : 6 - Math.abs(7 - n);

/** The two "red" numbers, which may not sit next to each other. */
const isHotNumber = (n?: number): boolean => n === 6 || n === 8;

/** Fog is water until a ship reveals it, so it is not land for any purpose. */
export const isLandTerrain = (t: Terrain): boolean =>
  t !== 'sea' && t !== 'fog';

const needsNumber = (hex: Hex): boolean =>
  hex.number === undefined && PRODUCING_TERRAINS.includes(hex.terrain);

// ---------------------------------------------------------------------------
// Terrain and number supplies
// ---------------------------------------------------------------------------

/** The classic 19-hex mix, minus the desert, expressed as shares. */
const CLASSIC_MIX: { terrain: Terrain; share: number }[] = [
  { terrain: 'forest', share: 4 },
  { terrain: 'pasture', share: 4 },
  { terrain: 'fields', share: 4 },
  { terrain: 'hills', share: 3 },
  { terrain: 'mountains', share: 3 },
];
const CLASSIC_LAND = 19;

/**
 * Split `total` into buckets sized by `weights`, largest remainder first, so the
 * parts always add back up to `total`.
 */
function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const counts = exact.map(Math.floor);
  const order = exact
    .map((v, i) => ({ i, frac: v - counts[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  let left = total - counts.reduce((a, b) => a + b, 0);
  for (let k = 0; left > 0; k++, left--) counts[order[k % order.length].i]++;
  return counts;
}

/** The terrain supply for a land mass of `landCount` hexes, classic ratios. */
export function landTerrains(landCount: number): Terrain[] {
  if (landCount <= 0) return [];
  const deserts = Math.min(landCount, Math.max(1, Math.round(landCount / CLASSIC_LAND)));
  const counts = apportion(
    landCount - deserts,
    CLASSIC_MIX.map((m) => m.share),
  );
  const out: Terrain[] = [];
  CLASSIC_MIX.forEach((m, i) => {
    for (let j = 0; j < counts[i]; j++) out.push(m.terrain);
  });
  for (let j = 0; j < deserts; j++) out.push('desert');
  return out;
}

/** The 18 tokens of the standard set. */
const TOKEN_SET = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

/**
 * The same multiset, ordered so that any prefix is still a sane spread: the
 * common numbers come first and the 2/12 pair is only reached late. Boards that
 * are not a multiple of 18 hexes take a prefix of this.
 */
const TOKEN_FILL = [5, 9, 4, 10, 6, 8, 3, 11, 5, 9, 4, 10, 2, 12, 6, 8, 3, 11];

/** `count` number tokens, the classic 18 for a classic board. */
export function numberTokens(count: number): number[] {
  const out: number[] = [];
  while (out.length + TOKEN_SET.length <= count) out.push(...TOKEN_SET);
  out.push(...TOKEN_FILL.slice(0, count - out.length));
  return out;
}

// ---------------------------------------------------------------------------
// Balance constraints
// ---------------------------------------------------------------------------

/** Highest pip total allowed on a single vertex, i.e. per settlement spot. */
const MAX_VERTEX_PIPS = 13;

type HexMap = Map<HexKey, Hex>;

const mapOf = (hexes: Hex[]): HexMap =>
  new Map(hexes.map((h) => [hexKey(h.coord), h]));

interface BalanceStage {
  hotNumbers: boolean;
  vertexPips: boolean;
  tries: number;
}

/**
 * Relaxation ladder. A dense board can make the strict rules unsatisfiable for
 * a given shuffle, so each stage drops one, and the last one takes what it is
 * given — generation must terminate on every seed.
 */
const NUMBER_STAGES: BalanceStage[] = [
  { hotNumbers: true, vertexPips: true, tries: 500 },
  { hotNumbers: true, vertexPips: false, tries: 200 },
  { hotNumbers: false, vertexPips: false, tries: 1 },
];

const TERRAIN_TRIES = 500;

/** Whether `n` can go on `hex` without breaking the stage's rules. */
function tokenFits(
  map: HexMap,
  hex: Hex,
  n: number,
  stage: BalanceStage,
): boolean {
  const self = hexKey(hex.coord);
  if (stage.hotNumbers && isHotNumber(n)) {
    for (const nb of neighbors(hex.coord)) {
      if (isHotNumber(map.get(hexKey(nb))?.number)) return false;
    }
  }
  if (stage.vertexPips) {
    for (const v of hexVertices(hex.coord)) {
      let pips = pipsFor(n);
      for (const h of vertexHexes(v)) {
        const key = hexKey(h);
        if (key === self) continue;
        pips += pipsFor(map.get(key)?.number ?? 0);
      }
      if (pips > MAX_VERTEX_PIPS) return false;
    }
  }
  return true;
}

/**
 * One shuffled pass: walk the hexes in random order and give each the first
 * token from a shuffled pool that still satisfies the constraints. Placing
 * under constraint rather than shuffling-then-checking is what makes big
 * boards solvable — a blind reshuffle of 8 red numbers essentially never
 * lands a legal layout.
 */
function dealPass(
  map: HexMap,
  targets: Hex[],
  tokens: number[],
  stage: BalanceStage,
  rng: Rng,
): boolean {
  for (const hex of targets) delete hex.number;
  const pool = rng.shuffle(tokens);
  for (const hex of rng.shuffle(targets)) {
    const i = pool.findIndex((n) => tokenFits(map, hex, n, stage));
    if (i < 0) {
      for (const other of targets) delete other.number;
      return false;
    }
    hex.number = pool[i];
    pool.splice(i, 1);
  }
  return true;
}

/**
 * Deal number tokens to every producing hex that was not given one by hand.
 * Mutates `hexes`, which are freshly built inside this module.
 */
function assignNumbers(hexes: Hex[], rng: Rng): void {
  const targets = hexes.filter(needsNumber);
  if (!targets.length) return;
  const tokens = numberTokens(targets.length);
  const map = mapOf(hexes);

  for (const stage of NUMBER_STAGES) {
    for (let attempt = 0; attempt < stage.tries; attempt++) {
      if (dealPass(map, targets, tokens, stage, rng)) return;
    }
  }
}

/** Whether `terrain` at `coord` would complete a same-terrain triangle. */
function terrainFits(map: HexMap, coord: HexCoord, terrain: Terrain): boolean {
  if (terrain === 'desert' || !isLandTerrain(terrain)) return true;
  for (let d = 0; d < 6; d++) {
    const a = map.get(hexKey(neighbor(coord, d)));
    const b = map.get(hexKey(neighbor(coord, d + 1)));
    if (a?.terrain === terrain && b?.terrain === terrain) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Islands
// ---------------------------------------------------------------------------

/**
 * Number the land masses by flood fill. The biggest is island 0 — the one
 * everybody starts on — so scenario bonuses can key off "anything but 0".
 */
function assignIslands(hexes: Hex[]): void {
  const map = mapOf(hexes);
  const seen = new Set<HexKey>();
  const groups: HexKey[][] = [];

  for (const hex of hexes) {
    const start = hexKey(hex.coord);
    if (!isLandTerrain(hex.terrain) || seen.has(start)) continue;
    const group: HexKey[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const key = queue.pop() as HexKey;
      group.push(key);
      for (const n of neighbors(parseHexKey(key))) {
        const nk = hexKey(n);
        const other = map.get(nk);
        if (!other || seen.has(nk) || !isLandTerrain(other.terrain)) continue;
        seen.add(nk);
        queue.push(nk);
      }
    }
    groups.push(group);
  }

  groups
    .map((g) => ({ g, anchor: [...g].sort()[0] }))
    .sort((a, b) => b.g.length - a.g.length || a.anchor.localeCompare(b.anchor))
    .forEach(({ g }, island) => {
      for (const key of g) (map.get(key) as Hex).island = island;
    });
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

interface PortSite {
  sea: HexCoord;
  island: number;
  vertices: VertexId[];
}

/** The standard 4 generic / 5 specific mix, scaled to `count`. */
export function standardPortKinds(count: number): PortKind[] {
  if (count <= 0) return [];
  const generic = Math.max(1, Math.round((count * 4) / 9));
  const kinds: PortKind[] = Array.from({ length: Math.min(generic, count) }, () => 'any');
  for (let i = kinds.length; i < count; i++) {
    kinds.push(RESOURCES[(i - generic) % RESOURCES.length]);
  }
  return kinds;
}

/** One candidate per coastal sea hex, facing a randomly chosen land neighbour. */
function portSites(hexes: Hex[], rng: Rng): PortSite[] {
  const map = mapOf(hexes);
  const sites: PortSite[] = [];
  for (const hex of hexes) {
    if (hex.terrain !== 'sea') continue;
    const facing = neighbors(hex.coord)
      .map((n) => map.get(hexKey(n)))
      .filter((h): h is Hex => !!h && isLandTerrain(h.terrain));
    if (!facing.length) continue;
    const land = rng.pick(facing);
    sites.push({
      sea: hex.coord,
      island: land.island ?? 0,
      vertices: edgeVertices(makeEdgeId(hex.coord, land.coord)),
    });
  }
  return sites;
}

/** Order coastal hexes the way they lie around their island, so gaps are even. */
function aroundCoast(sites: PortSite[]): PortSite[] {
  const points = sites.map((s) => hexToPixel(s.sea, 1));
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  return sites
    .map((site, i) => ({ site, angle: Math.atan2(points[i].y - cy, points[i].x - cx) }))
    .sort((a, b) => a.angle - b.angle)
    .map((e) => e.site);
}

/**
 * Spread `count` ports around the coast, never letting two share a vertex.
 * Each island gets a share proportional to how much coastline it has.
 */
function placePorts(
  hexes: Hex[],
  count: number,
  kinds: PortKind[],
  rng: Rng,
): Port[] {
  if (count <= 0) return [];
  const sites = portSites(hexes, rng);
  if (!sites.length) return [];

  const byIsland = new Map<number, PortSite[]>();
  for (const site of sites) {
    const list = byIsland.get(site.island);
    if (list) list.push(site);
    else byIsland.set(site.island, [site]);
  }
  const groups = [...byIsland.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, group]) => group);
  const quotas = apportion(count, groups.map((g) => g.length));

  const used = new Set<VertexId>();
  const chosen: PortSite[] = [];

  groups.forEach((group, gi) => {
    const coast = aroundCoast(group);
    const want = Math.min(quotas[gi], coast.length);
    if (want <= 0) return;
    const taken = new Set<number>();
    let placed = 0;

    const take = (index: number): void => {
      if (placed >= want || taken.has(index)) return;
      const site = coast[index];
      if (site.vertices.some((v) => used.has(v))) return;
      taken.add(index);
      site.vertices.forEach((v) => used.add(v));
      chosen.push(site);
      placed++;
    };

    // Evenly spaced first, then fill in behind anything that collided.
    const start = rng.int(coast.length);
    for (let j = 0; j < want; j++) {
      take((start + Math.round((j * coast.length) / want)) % coast.length);
    }
    for (let i = 0; i < coast.length && placed < want; i++) take(i);
  });

  const mix = rng.shuffle(kinds);
  return chosen.map((site, i) => {
    const kind = mix[i] ?? 'any';
    return {
      vertices: site.vertices,
      kind,
      ratio: kind === 'any' ? (3 as const) : (2 as const),
      hex: site.sea,
    };
  });
}

// ---------------------------------------------------------------------------
// Assembling a board
// ---------------------------------------------------------------------------

/** One hand-placed hex. Scenarios are written as lists of these. */
export interface HexSpec {
  q: number;
  r: number;
  terrain: Terrain;
  /** Fixed token; omit to let the generator deal one. */
  number?: number;
  hidden?: { terrain: Terrain; number?: number };
}

export interface AssembleOptions {
  /** Rings of open water added around everything. One is enough to sail. */
  seaMargin?: number;
  /** How many ports to place. */
  ports?: number;
  /** Override the port mix; defaults to the standard 4 generic / 5 specific. */
  portKinds?: PortKind[];
  /** Place the pirate in open water. */
  seafarers?: boolean;
}

/** Grow `margin` rings of sea around the placed hexes. */
function withSea(specs: HexSpec[], margin: number): Hex[] {
  const map: HexMap = new Map();
  for (const spec of specs) {
    const coord = { q: spec.q, r: spec.r };
    const hex: Hex = { coord, terrain: spec.terrain };
    if (spec.number !== undefined) hex.number = spec.number;
    if (spec.hidden) hex.hidden = { ...spec.hidden };
    map.set(hexKey(coord), hex);
  }

  let frontier = specs.map((s) => ({ q: s.q, r: s.r }));
  for (let ring = 0; ring < margin; ring++) {
    const next: HexCoord[] = [];
    for (const coord of frontier) {
      for (const n of neighbors(coord)) {
        const key = hexKey(n);
        if (map.has(key)) continue;
        map.set(key, { coord: n, terrain: 'sea' });
        next.push(n);
      }
    }
    frontier = next;
  }
  return [...map.values()];
}

/** Farthest patch of open water from the middle of the map. */
function openWater(hexes: Hex[]): HexCoord | undefined {
  const sea = hexes.filter((h) => h.terrain === 'sea');
  if (!sea.length) return undefined;
  const points = hexes.map((h) => hexToPixel(h.coord, 1));
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  let best = sea[0];
  let bestD = -1;
  for (const hex of sea) {
    const p = hexToPixel(hex.coord, 1);
    const d = (p.x - cx) ** 2 + (p.y - cy) ** 2;
    if (d > bestD || (d === bestD && hexKey(hex.coord) < hexKey(best.coord))) {
      best = hex;
      bestD = d;
    }
  }
  return best.coord;
}

/**
 * Turn a hand-placed (or generated) hex list into a finished board: water
 * around the edges, tokens dealt, islands numbered, ports placed, and the
 * buildable vertex/edge sets derived.
 */
export function assembleBoard(
  specs: HexSpec[],
  rng: Rng,
  options: AssembleOptions = {},
): Board {
  const hexes = withSea(specs, options.seaMargin ?? 1);
  assignNumbers(hexes, rng);
  demoteGoldNumbers(hexes);
  assignIslands(hexes);

  const portCount = options.ports ?? 0;
  const ports = placePorts(
    hexes,
    portCount,
    options.portKinds ?? standardPortKinds(portCount),
    rng,
  );

  const map = mapOf(hexes);
  const onBoard = (edge: EdgeId): boolean =>
    edgeHexes(edge).every((h) => map.has(hexKey(h)));

  const landVertices = new Set<VertexId>();
  const roadEdges = new Set<EdgeId>();
  const shipEdges = new Set<EdgeId>();
  for (const hex of hexes) {
    const land = isLandTerrain(hex.terrain);
    for (const edge of hexEdges(hex.coord)) {
      if (!onBoard(edge)) continue;
      if (land) roadEdges.add(edge);
      else shipEdges.add(edge);
    }
    if (!land) continue;
    for (const v of hexVertices(hex.coord)) landVertices.add(v);
  }

  const desert = hexes.find((h) => h.terrain === 'desert');
  const robber =
    desert?.coord ??
    hexes.find((h) => isLandTerrain(h.terrain))?.coord ??
    hexes[0].coord;

  const board: Board = {
    hexes,
    ports,
    landVertices: [...landVertices].sort(),
    roadEdges: [...roadEdges].sort(),
    shipEdges: [...shipEdges].sort(),
    robber,
  };
  if (options.seafarers) {
    const pirate = openWater(hexes);
    if (pirate) board.pirate = pirate;
  }
  return board;
}

// ---------------------------------------------------------------------------
// Random boards
// ---------------------------------------------------------------------------

/**
 * Shuffle the terrain supply onto the island, avoiding same-terrain triangles.
 * Same shape as the token deal: place under constraint, retry the whole pass,
 * and give up gracefully rather than spin.
 */
function layoutTerrain(
  coords: HexCoord[],
  terrains: Terrain[],
  rng: Rng,
): HexSpec[] {
  for (let attempt = 0; attempt < TERRAIN_TRIES; attempt++) {
    const map: HexMap = new Map();
    const pool = rng.shuffle(terrains);
    let stuck = false;
    for (const coord of rng.shuffle(coords)) {
      const i = pool.findIndex((t) => terrainFits(map, coord, t));
      if (i < 0) {
        stuck = true;
        break;
      }
      map.set(hexKey(coord), { coord, terrain: pool[i] });
      pool.splice(i, 1);
    }
    if (!stuck) {
      return coords.map((c) => ({
        q: c.q,
        r: c.r,
        terrain: (map.get(hexKey(c)) as Hex).terrain,
      }));
    }
  }
  const draw = rng.shuffle(terrains); // constraint relaxed rather than looping forever
  return coords.map((c, i) => ({ q: c.q, r: c.r, terrain: draw[i] }));
}

/**
 * How much gold a board of this size can carry.
 *
 * Gold pays any resource, so a gold hex is strictly better than any ordinary
 * one on the same number — and on a 19-hex board two of them warp the whole
 * game. Roughly one per twelve land hexes keeps it a treat rather than the
 * only spot worth taking; a classic board therefore gets at most one.
 */
export const goldBudget = (landCount: number): number =>
  Math.max(0, Math.floor(landCount / 12));

/** Swap `count` producing hexes for gold. Gold always gets a token. */
function sprinkleGold(specs: HexSpec[], count: number, rng: Rng): void {
  const land = specs.filter((s) => isLandTerrain(s.terrain)).length;
  const allowed = Math.min(count, goldBudget(land));
  if (allowed <= 0) return;
  const eligible = specs
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.terrain !== 'desert' && isLandTerrain(s.terrain));
  for (const { i } of rng.shuffle(eligible).slice(0, allowed)) {
    specs[i].terrain = 'gold';
  }
}

/**
 * Give the gold hexes the least likely numbers on the board.
 *
 * Balancing gold by rarity rather than banning it outright: a 12 on gold is a
 * pleasant surprise, an 8 on gold decides the game on its own.
 *
 * A swap moves the gold hex's strong number onto an ordinary hex, which can
 * land it beside another 6 or 8 or overload a vertex — so each swap is checked
 * against the same constraints the dealer used, and abandoned if it breaks one.
 * A gold hex keeping a decent number is a far smaller problem than a board with
 * two 8s touching.
 */
function demoteGoldNumbers(hexes: Hex[]): void {
  const gold = hexes.filter((h) => h.terrain === 'gold' && h.number !== undefined);
  if (gold.length === 0) return;

  const others = hexes.filter(
    (h) => h.terrain !== 'gold' && h.number !== undefined && h.terrain !== 'desert',
  );

  const stage: BalanceStage = { hotNumbers: true, vertexPips: true, tries: 1 };

  for (const g of gold) {
    // Try partners from the weakest number upwards and take the first swap the
    // balance rules accept. Settling for the single weakest hex leaves gold on
    // a 6 whenever that one swap happens to be illegal.
    const candidates = others
      .filter((o) => pipsFor(o.number!) < pipsFor(g.number!))
      .sort((a, b) => pipsFor(a.number!) - pipsFor(b.number!));

    for (const partner of candidates) {
      const goldNumber = g.number;
      g.number = partner.number;
      partner.number = goldNumber;

      const map = mapOf(hexes);
      if (
        tokenFits(map, g, g.number!, stage) &&
        tokenFits(map, partner, partner.number!, stage)
      ) {
        break;
      }
      partner.number = g.number;
      g.number = goldNumber;
    }
  }
}

/**
 * A random hexagonal island of `options.boardRadius`, ringed by sea and ports.
 * Radius 2 is the classic 19-hex board.
 */
export function generateBoard(options: GameOptions, rng: Rng): Board {
  const radius = Math.max(1, Math.floor(options.boardRadius) || 2);
  const coords = hexSpiral(radius);
  const specs = layoutTerrain(coords, landTerrains(coords.length), rng);
  sprinkleGold(specs, Math.max(0, options.goldHexCount ?? 0), rng);

  // Half the coastline carries a port, which is 9 on a classic board.
  return assembleBoard(specs, rng, {
    seaMargin: 1,
    ports: 3 * (radius + 1),
    seafarers: options.expansions.seafarers,
  });
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

/**
 * A board preset. `build` is the only thing that touches randomness, and it
 * takes the game's own Rng so a scenario is as reproducible as a random board.
 */
export interface Scenario {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  victoryPointsToWin: number;
  expansions: GameOptions['expansions'];
  build(rng: Rng): Board;
  /**
   * Victory points for being first to settle a given island. Island 0 is where
   * everyone starts, so it never pays a bonus.
   */
  islandBonus?: Record<number, number>;
}
