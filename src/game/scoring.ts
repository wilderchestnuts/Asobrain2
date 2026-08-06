/**
 * Victory points and the two awards.
 *
 * Scores are recomputed from the board every time rather than accumulated, so
 * they cannot drift when a city is destroyed, a road is cut, or an award
 * changes hands. `computeScores` is the only place that knows what a point is.
 *
 * Leaf module: it takes the rules modules as an argument instead of importing
 * them, which keeps `rules/base.ts` free to depend on it.
 */

import type { RulesModule } from './engine';
import type { EdgeId, VertexId } from './hex';
import { edgeVertices } from './hex';
import type { GameState, PlayerId } from './types';

/** Shortest road that can take the award, and smallest army. */
export const LONGEST_ROAD_MINIMUM = 5;
export const LARGEST_ARMY_MINIMUM = 3;

export interface PlayerScore {
  settlements: number;
  cities: number;
  longestRoad: number;
  largestArmy: number;
  /** Points contributed by enabled expansion modules. */
  modules: number;
  /** Face-up total — what opponents are allowed to see. */
  publicPoints: number;
  /** Unrevealed victory-point development cards. */
  hiddenPoints: number;
  total: number;
}

export function computeScores(
  state: GameState,
  modules: readonly RulesModule[] = [],
): Record<PlayerId, PlayerScore> {
  const out: Record<PlayerId, PlayerScore> = {};
  for (const p of state.players) {
    const buildings = state.settlements.filter((s) => s.owner === p.id);
    const settlements = buildings.filter((s) => s.kind === 'settlement').length;
    const cities = buildings.filter((s) => s.kind === 'city').length * 2;
    const longestRoad = state.longestRoad?.owner === p.id ? 2 : 0;
    const largestArmy = state.largestArmy?.owner === p.id ? 2 : 0;

    let modulePoints = 0;
    for (const m of modules) {
      if (m.enabled(state) && m.score) modulePoints += m.score(state, p);
    }

    const hiddenPoints = p.devCards.filter(
      (c) => c.kind === 'victory_point',
    ).length;

    const publicPoints =
      settlements + cities + longestRoad + largestArmy + modulePoints;

    out[p.id] = {
      settlements,
      cities,
      longestRoad,
      largestArmy,
      modules: modulePoints,
      publicPoints,
      hiddenPoints,
      total: publicPoints + hiddenPoints,
    };
  }
  return out;
}

/**
 * Write the recomputed totals back onto the players. `victoryPoints` is the
 * public figure the UI may show to everyone; `hiddenPoints` is the part only
 * the owner (and the server) knows about.
 */
export function applyScores(
  state: GameState,
  modules: readonly RulesModule[] = [],
): Record<PlayerId, PlayerScore> {
  const scores = computeScores(state, modules);
  for (const p of state.players) {
    const s = scores[p.id];
    p.victoryPoints = s.publicPoints;
    p.hiddenPoints = s.hiddenPoints;
  }
  return scores;
}

// ---------------------------------------------------------------------------
// Longest road
// ---------------------------------------------------------------------------

/**
 * Length of this player's longest continuous route.
 *
 * The route is the longest *trail* through their road/ship graph — edges may
 * not repeat, vertices may (so a closed loop of six counts as six). A vertex
 * carrying an opponent's settlement or city is a dead end: a route may finish
 * there but not continue through it, which is how an opponent cuts a road.
 */
export function longestRouteLength(
  state: GameState,
  playerId: PlayerId,
): number {
  const owned = state.roads.filter((r) => r.owner === playerId);
  if (owned.length === 0) return 0;

  const incident = new Map<VertexId, EdgeId[]>();
  const endpoints = new Map<EdgeId, VertexId[]>();
  for (const piece of owned) {
    const ends = edgeVertices(piece.edge);
    endpoints.set(piece.edge, ends);
    for (const v of ends) {
      const list = incident.get(v);
      if (list) list.push(piece.edge);
      else incident.set(v, [piece.edge]);
    }
  }

  const blocked = new Set(
    state.settlements.filter((s) => s.owner !== playerId).map((s) => s.vertex),
  );

  let best = 0;
  const used = new Set<EdgeId>();

  const walk = (vertex: VertexId, length: number): void => {
    if (length > best) best = length;
    // You may end a route at an opponent's building, but not pass through it.
    if (blocked.has(vertex)) return;
    for (const edge of incident.get(vertex) ?? []) {
      if (used.has(edge)) continue;
      const next = endpoints.get(edge)!.find((v) => v !== vertex);
      if (next === undefined) continue;
      used.add(edge);
      walk(next, length + 1);
      used.delete(edge);
    }
  };

  for (const start of incident.keys()) walk(start, 0);
  return best;
}

/**
 * Recompute the longest-road award.
 *
 * The holder keeps it while tied — it is only lost by being beaten outright,
 * or by dropping under five. If a break leaves several players tied and none
 * of them is the holder, the award goes back in the box until one is alone.
 */
export function updateLongestRoad(state: GameState): void {
  const lengths = new Map<PlayerId, number>();
  for (const p of state.players) {
    lengths.set(p.id, longestRouteLength(state, p.id));
  }
  const best = Math.max(0, ...lengths.values());

  if (best < LONGEST_ROAD_MINIMUM) {
    delete state.longestRoad;
    return;
  }
  const leaders = [...lengths.entries()]
    .filter(([, len]) => len === best)
    .map(([id]) => id);

  const holder = state.longestRoad?.owner;
  if (holder && leaders.includes(holder)) {
    state.longestRoad = { owner: holder, length: best };
    return;
  }
  if (leaders.length === 1) {
    state.longestRoad = { owner: leaders[0], length: best };
    return;
  }
  delete state.longestRoad;
}

// ---------------------------------------------------------------------------
// Largest army
// ---------------------------------------------------------------------------

/** Same tie-breaking as longest road: the holder keeps it until beaten. */
export function updateLargestArmy(state: GameState): void {
  const best = Math.max(0, ...state.players.map((p) => p.knightsPlayed));
  if (best < LARGEST_ARMY_MINIMUM) {
    delete state.largestArmy;
    return;
  }
  const leaders = state.players
    .filter((p) => p.knightsPlayed === best)
    .map((p) => p.id);

  const holder = state.largestArmy?.owner;
  if (holder && leaders.includes(holder)) {
    state.largestArmy = { owner: holder, size: best };
    return;
  }
  if (leaders.length === 1) {
    state.largestArmy = { owner: leaders[0], size: best };
    return;
  }
  delete state.largestArmy;
}

export function updateAwards(state: GameState): void {
  updateLongestRoad(state);
  updateLargestArmy(state);
}
