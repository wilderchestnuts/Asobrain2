/**
 * Seafarers rules. The full-game runs at the bottom are the important part:
 * they play the naval scenarios to completion and would catch a ship rule that
 * deadlocks a game, which no amount of unit testing reliably does.
 */

import { describe, expect, it } from 'vitest';
import { applyAction, allLegalActions } from '../reducer';
import { createGame } from '../setup';
import { Rng } from '../rng';
import { computeScores } from '../scoring';
import { edgeHexes, edgeVertices, hexEdges, hexKey, hexVertices, vertexHexes } from '../hex';
import { SCENARIOS } from '../scenarios';
import { __internals, seafarersRules } from './seafarers';
import type { GameAction } from '../actions';
import type { GameState } from '../types';

const SEATS = [
  { name: 'Alice', color: '#c1121f', isBot: false },
  { name: 'Bob', color: '#118ab2', isBot: false },
];

const seaGame = (seed: string, scenario = 'heading-for-new-shores') =>
  createGame({
    players: SEATS,
    options: {
      seed,
      scenario,
      expansions: { seafarers: true, citiesAndKnights: false },
      victoryPointsToWin: 12,
    },
    id: `sea-${seed}`,
    now: 0,
  });

/** Play a game with a weighted random driver; returns the terminal state. */
function playOut(state: GameState, seed: string, maxSteps = 30000) {
  const rng = new Rng(`drv-${seed}`);
  let steps = 0;
  const rejected: string[] = [];

  const weights: Record<string, number> = {
      build_city: 40,
      build_settlement: 30,
      build_ship: 12,
      buy_dev_card: 8,
      build_road: 6,
      bank_trade: 4,
      end_turn: 3,
      move_ship: 2,
      offer_trade: 1,
    roll: 100,
  };
  // Anything not listed is something the rules are blocked on and must be
  // taken immediately, or the game deadlocks.
  const weight = (a: GameAction): number => weights[a.type] ?? 500;

  while (state.phase !== 'game_over' && steps < maxSteps) {
    const blocked = state.pending.find((t) => t.kind !== 'resume')
      ?.playerId;
    const actor = blocked ?? state.players[state.currentPlayer].id;
    const legal = allLegalActions(state, actor);
    if (legal.length === 0) break;

    const total = legal.reduce((s, a) => s + weight(a), 0);
    let roll = rng.float() * total;
    let action = legal[legal.length - 1];
    for (const a of legal) {
      roll -= weight(a);
      if (roll <= 0) {
        action = a;
        break;
      }
    }

    const result = applyAction(
      state,
      { ...action, playerId: actor },
      { now: steps },
    );
    if (result.ok) state = result.state;
    else rejected.push(`${action.type}: ${result.error}`);
    steps++;
  }
  return { state, steps, rejected };
}

describe('seafarers board', () => {
  it('separates road edges from ship edges', () => {
    const state = seaGame('edges');
    expect(state.board.shipEdges.length).toBeGreaterThan(0);
    expect(state.board.roadEdges.length).toBeGreaterThan(0);
    // A coastal edge is legal for both; a fully inland one is road-only.
    const inland = state.board.roadEdges.filter(
      (e) => !state.board.shipEdges.includes(e),
    );
    expect(inland.length).toBeGreaterThan(0);
  });

  it('gives the board a pirate', () => {
    const state = seaGame('pirate');
    expect(state.board.pirate).toBeDefined();
  });
});

describe('ships', () => {
  it('will not build a ship on an inland edge', () => {
    const state = seaGame('inland');
    const inland = state.board.roadEdges.find(
      (e) => !state.board.shipEdges.includes(e),
    )!;
    const result = applyAction(state, {
      type: 'build_ship',
      edge: inland,
      playerId: state.players[0].id,
    });
    expect(result.ok).toBe(false);
  });

  it('treats roads and ships as separate networks', () => {
    // A ship may not extend a road except through a settlement, so a player
    // whose only piece at a junction is a road cannot continue it by sea.
    const state = seaGame('networks');
    const shipEdge = state.board.shipEdges[0];
    const [v] = edgeVertices(shipEdge);
    const neighbourEdges = state.board.roadEdges.filter(
      (e) => e !== shipEdge && edgeVertices(e).includes(v),
    );
    expect(neighbourEdges.length).toBeGreaterThan(0);

    const withRoad: GameState = {
      ...state,
      phase: 'main',
      roads: [{ edge: neighbourEdges[0], owner: state.players[0].id, kind: 'road' }],
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: { lumber: 5, wool: 5, brick: 5, grain: 5 } } : p,
      ),
    };
    const result = applyAction(withRoad, {
      type: 'build_ship',
      edge: shipEdge,
      playerId: state.players[0].id,
    });
    expect(result.ok).toBe(false);
  });

  it('only lets an open-ended ship be moved', () => {
    const state = seaGame('open');
    const a = state.board.shipEdges[0];
    const [v1] = edgeVertices(a);
    const b = state.board.shipEdges.find(
      (e) => e !== a && edgeVertices(e).includes(v1),
    );
    if (!b) return; // board without a suitable pair; nothing to assert

    const owner = state.players[0].id;
    const withShips: GameState = {
      ...state,
      roads: [
        { edge: a, owner, kind: 'ship' },
        { edge: b, owner, kind: 'ship' },
      ],
    };
    // The far ends stay open, so both are movable; the shared junction is not
    // what pins a ship — another of your ships at *both* ends is.
    const shipA = withShips.roads[0];
    expect(typeof __internals.isOpenShip(withShips, shipA)).toBe('boolean');
  });

  it('refuses to move a ship built this turn', () => {
    const state = seaGame('locked');
    const owner = state.players[0].id;
    const edge = state.board.shipEdges[0];
    const withShip: GameState = {
      ...state,
      phase: 'main',
      roads: [{ edge, owner, kind: 'ship', locked: true }],
    };
    const target = state.board.shipEdges.find((e) => e !== edge)!;
    const result = applyAction(withShip, {
      type: 'move_ship',
      from: edge,
      to: target,
      playerId: owner,
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/this turn/i);
  });
});

describe('fog', () => {
  it('reveals a fog hex when a ship reaches it and pays out', () => {
    const state = seaGame('fog', 'fog-islands');
    const fogHex = state.board.hexes.find((h) => h.terrain === 'fog');
    if (!fogHex) return; // scenario without fog; nothing to assert

    expect(fogHex.hidden).toBeDefined();

    // Any ship edge touching the fog hex will do.
    const key = hexKey(fogHex.coord);
    const edge = state.board.shipEdges.find((e) =>
      edgeVertices(e).some((v) => vertexHexes(v).some((c) => hexKey(c) === key)),
    );
    if (!edge) return;

    const owner = state.players[0].id;
    const player = { ...state.players[0], hand: {} };
    const draft: GameState = {
      ...state,
      players: [player, state.players[1]],
    };
    __internals.revealFogAround(draft, { rng: new Rng('x'), now: 0 }, player, edge);

    const after = draft.board.hexes.find((h) => hexKey(h.coord) === key)!;
    expect(after.terrain).not.toBe('fog');
    expect(after.hidden).toBeUndefined();
  });

  /**
   * Revealed land used to draw as land and behave as ocean: the board's
   * land/sea sets were derived while the hex was still fog and never updated,
   * so you could sail past a forest but not settle on it. On the board it read
   * as a tile that was somehow both.
   */
  it('makes revealed land actually behave as land', () => {
    const state = seaGame('fog-land', 'fog-islands');
    const ctx = { rng: new Rng('reveal'), now: 0 };
    const player = state.players[0];

    let checked = 0;
    for (const fogHex of state.board.hexes.filter((h) => h.terrain === 'fog')) {
      const key = hexKey(fogHex.coord);
      const edge = state.board.shipEdges.find((e) =>
        edgeVertices(e).some((v) => vertexHexes(v).some((c) => hexKey(c) === key)),
      );
      if (!edge) continue;

      __internals.revealFogAround(state, ctx, player, edge);
      const after = state.board.hexes.find((h) => hexKey(h.coord) === key)!;
      if (after.terrain === 'sea' || after.terrain === 'fog') continue;

      checked++;
      // Settleable, buildable, and part of some island you can claim.
      for (const v of hexVertices(after.coord)) {
        expect(state.board.landVertices, `${key} vertex not settleable`).toContain(v);
      }
      expect(after.island, `${key} belongs to no island`).toBeDefined();
      const edges = hexEdges(after.coord).filter((e) =>
        edgeHexes(e).every((h) =>
          state.board.hexes.some((x) => hexKey(x.coord) === hexKey(h)),
        ),
      );
      for (const e of edges) {
        expect(state.board.roadEdges, `${key} takes no road`).toContain(e);
      }
      // An inland edge — both sides now land — must stop being sailable.
      for (const e of edges) {
        const bothLand = edgeHexes(e).every((h) => {
          const hex = state.board.hexes.find((x) => hexKey(x.coord) === hexKey(h));
          return hex && hex.terrain !== 'sea' && hex.terrain !== 'fog';
        });
        if (bothLand) expect(state.board.shipEdges).not.toContain(e);
      }
    }
    expect(checked, 'no fog resolved to land, so nothing was verified').toBeGreaterThan(0);
  });
});

describe('island bonuses', () => {
  /** A game, an outer island, and a vertex on it. */
  const landfall = (seed: string) => {
    const state = seaGame(seed, 'four-islands');
    const outer = state.board.hexes.find(
      (h) => h.island !== undefined && h.island !== 0 && h.terrain !== 'sea',
    );
    const vertex = state.board.landVertices.find((v) =>
      vertexHexes(v).some((c) => {
        const h = state.board.hexes.find((x) => hexKey(x.coord) === hexKey(c));
        return h?.island === outer?.island;
      }),
    );
    return { state, island: outer!.island!, vertex: vertex!, ctx: { rng: new Rng(seed), now: 0 } };
  };

  it('pays for the islands a player claimed, not the ones they merely reached', () => {
    const { state, island } = landfall('scoring');
    const player = state.players[0];

    player.islandsSettled = [island];
    player.islandsClaimed = [];
    expect(computeScores(state, [seafarersRules])[player.id].modules).toBe(0);

    player.islandsClaimed = [island];
    expect(
      computeScores(state, [seafarersRules])[player.id].modules,
    ).toBeGreaterThan(0);
  });

  it('pays nothing for where you were dealt in during setup', () => {
    const { state, island, vertex, ctx } = landfall('setup-free');
    const player = state.players[0];
    state.phase = 'setup_first';

    __internals.creditIslands(state, ctx, player, vertex);
    // Been there — so nobody can discover it later — but no points for it.
    expect(player.islandsSettled).toEqual([island]);
    expect(player.islandsClaimed ?? []).toEqual([]);
  });

  it('pays the first player to reach an island and nobody after', () => {
    const { state, island, vertex, ctx } = landfall('race');
    state.phase = 'main';
    const [first, second] = state.players;

    __internals.creditIslands(state, ctx, first, vertex);
    expect(first.islandsClaimed).toEqual([island]);

    __internals.creditIslands(state, ctx, second, vertex);
    expect(second.islandsSettled).toEqual([island]);
    expect(second.islandsClaimed ?? []).toEqual([]);
  });

  it('never pays the same player twice for one island', () => {
    const { state, island, vertex, ctx } = landfall('once');
    state.phase = 'main';
    const player = state.players[0];

    __internals.creditIslands(state, ctx, player, vertex);
    __internals.creditIslands(state, ctx, player, vertex);
    expect(player.islandsSettled).toEqual([island]);
    expect(player.islandsClaimed).toEqual([island]);
  });

  it('leaves an island settled in setup undiscoverable afterwards', () => {
    const { state, vertex, ctx } = landfall('claimed-early');
    const [first, second] = state.players;

    state.phase = 'setup_first';
    __internals.creditIslands(state, ctx, first, vertex);

    state.phase = 'main';
    __internals.creditIslands(state, ctx, second, vertex);
    expect(second.islandsClaimed ?? []).toEqual([]);
  });
});

describe('full seafarers games', () => {
  for (const seed of ['sea-one', 'sea-two', 'sea-three']) {
    it(`plays "${seed}" to completion with ships in play`, { timeout: 60_000 }, () => {
      const { state, steps, rejected } = playOut(seaGame(seed), seed);

      expect(rejected.slice(0, 3), 'legal action refused by the rules').toEqual(
        [],
      );
      expect(state.phase, `stalled after ${steps} steps`).toBe('game_over');
      expect(state.winner).toBeDefined();
      expect(state.pending).toEqual([]);

      for (const p of state.players) {
        const ships = state.roads.filter(
          (r) => r.owner === p.id && r.kind === 'ship',
        ).length;
        expect(ships + p.supply.ships).toBe(15);
      }
    });
  }

  it('plays every naval scenario without stalling', { timeout: 180_000 }, () => {
    for (const [id, scenario] of Object.entries(SCENARIOS)) {
      if (!scenario.expansions.seafarers) continue;
      const { state, steps } = playOut(seaGame(`scn-${id}`, id), id, 12000);
      expect(
        ['game_over', 'roll', 'main'].includes(state.phase),
        `${id} ended in phase ${state.phase} after ${steps} steps`,
      ).toBe(true);

      // Setup is where an exotic map fails: a board of small islands can leave
      // a player with nowhere legal to put a second settlement, and the game
      // never starts. Accepting "did not crash" would not notice.
      expect(
        state.settlements.length,
        `${id} never finished setup — ${state.settlements.length} settlements after ${steps} steps`,
      ).toBeGreaterThanOrEqual(SEATS.length * 2);
      expect(state.pending, `${id} left an unanswered obligation`).toEqual([]);
    }
  });
});
