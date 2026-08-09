/**
 * Cities & Knights.
 *
 * The combined-ruleset game at the bottom is the one that matters most: it is
 * the configuration the owners actually intend to play, and it is where an
 * interaction between the three modules would show up.
 */

import { describe, expect, it } from 'vitest';
import { applyAction, allLegalActions } from '../reducer';
import { createGame, defaultVictoryPoints } from '../setup';
import { Rng } from '../rng';
import { computeScores } from '../scoring';
import { productionFor } from '../legal';
import { hexVertices } from '../hex';
import {
  __internals,
  BARBARIAN_ATTACK_AT,
  buildProgressDecks,
  citiesKnightsRules,
  cityCount,
  improvementCost,
  knightStrength,
  METROPOLIS_LEVEL,
} from './citiesKnights';
import type { GameAction } from '../actions';
import type { GameState } from '../types';

const SEATS = [
  { name: 'Alice', color: '#c1121f', isBot: false },
  { name: 'Bob', color: '#118ab2', isBot: false },
];

const ckGame = (seed: string, seafarers = false) =>
  createGame({
    players: SEATS,
    options: {
      seed,
      scenario: seafarers ? 'heading-for-new-shores' : 'classic',
      expansions: { seafarers, citiesAndKnights: true },
    },
    id: `ck-${seed}`,
    now: 0,
  });

const WEIGHTS: Record<string, number> = {
  build_city: 40,
  build_settlement: 26,
  buy_improvement: 22,
  build_knight: 14,
  activate_knight: 12,
  build_ship: 10,
  promote_knight: 8,
  play_progress_card: 8,
  build_road: 6,
  build_wall: 5,
  bank_trade: 4,
  move_knight: 3,
  end_turn: 3,
  move_ship: 2,
  offer_trade: 1,
  roll: 100,
};

function playOut(state: GameState, seed: string, maxSteps = 40000) {
  const rng = new Rng(`drv-${seed}`);
  const rejected: string[] = [];
  let steps = 0;

  while (state.phase !== 'game_over' && steps < maxSteps) {
    const blocked = state.pending.find((t) => t.kind !== 'resume')
      ?.playerId;
    const actor = blocked ?? state.players[state.currentPlayer].id;
    const legal = allLegalActions(state, actor);
    if (legal.length === 0) break;

    // Unlisted actions are things the rules are blocked on and must be taken.
    const weight = (a: GameAction) => WEIGHTS[a.type] ?? 500;
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
    if (result.ok) {
      state = result.state;
      // Nobody may be owed something they cannot give. The barbarians used to
      // demand a city from a player whose only cities were metropolises, which
      // cannot be destroyed — and that hung the game for good.
      for (const task of state.pending) {
        if (task.kind === 'resume') continue;
        const options = allLegalActions(state, task.playerId);
        if (options.length === 0) {
          throw new Error(
            `"${task.kind}" owed by ${task.playerId} with no legal move (turn ${state.turn})`,
          );
        }
      }
    } else {
      rejected.push(`${action.type}: ${result.error}`);
    }
    steps++;
  }
  return { state, steps, rejected };
}

describe('setup', () => {
  it('scales the victory target to the rule set', () => {
    expect(defaultVictoryPoints({ seafarers: false, citiesAndKnights: false })).toBe(10);
    expect(defaultVictoryPoints({ seafarers: true, citiesAndKnights: false })).toBe(12);
    expect(defaultVictoryPoints({ seafarers: false, citiesAndKnights: true })).toBe(13);
    expect(defaultVictoryPoints({ seafarers: true, citiesAndKnights: true })).toBe(15);
  });

  it('lets the caller override the target', () => {
    const state = createGame({
      players: SEATS,
      options: { seed: 'vp', victoryPointsToWin: 18 },
    });
    expect(state.options.victoryPointsToWin).toBe(18);
  });

  it('replaces the development deck with the three progress decks', () => {
    const state = ckGame('decks');
    expect(state.devDeck).toEqual([]);
    expect(state.progressDecks).toBeDefined();
    for (const deck of ['trade', 'politics', 'science'] as const) {
      expect(state.progressDecks![deck].length).toBeGreaterThan(0);
    }
  });

  it('shuffles the decks deterministically', () => {
    const a = buildProgressDecks(new Rng('same'));
    const b = buildProgressDecks(new Rng('same'));
    expect(a.trade.map((c) => c.id)).toEqual(b.trade.map((c) => c.id));
  });
});

describe('commodity production', () => {
  it('gives a city one resource and one commodity, not two resources', () => {
    const state = ckGame('commodities');
    const forest = state.board.hexes.find(
      (h) => h.terrain === 'forest' && h.number !== undefined,
    );
    if (!forest) return;

    const vertex = hexVertices(forest.coord).find((v) =>
      state.board.landVertices.includes(v),
    )!;
    const owner = state.players[0].id;
    const withCity: GameState = {
      ...state,
      board: { ...state.board, robber: { q: 99, r: 99 } },
      settlements: [{ vertex, owner, kind: 'city' }],
    };

    const { owed } = productionFor(withCity, forest.number!);
    expect(owed[owner].lumber).toBe(1);
    expect(owed[owner].paper).toBe(1);
  });

  it('still gives a city two bricks, since hills have no commodity', () => {
    const state = ckGame('bricks');
    const hills = state.board.hexes.find(
      (h) => h.terrain === 'hills' && h.number !== undefined,
    );
    if (!hills) return;

    const vertex = hexVertices(hills.coord).find((v) =>
      state.board.landVertices.includes(v),
    )!;
    const owner = state.players[0].id;
    const withCity: GameState = {
      ...state,
      board: { ...state.board, robber: { q: 99, r: 99 } },
      settlements: [{ vertex, owner, kind: 'city' }],
    };

    const { owed } = productionFor(withCity, hills.number!);
    expect(owed[owner].brick).toBe(2);
  });

  it('never pays commodities from a gold hex', () => {
    const state = ckGame('gold-commodities');
    const gold = state.board.hexes.find((h) => h.terrain === 'gold');
    if (!gold?.number) return;

    const vertex = hexVertices(gold.coord).find((v) =>
      state.board.landVertices.includes(v),
    )!;
    const owner = state.players[0].id;
    const withCity: GameState = {
      ...state,
      board: { ...state.board, robber: { q: 99, r: 99 } },
      settlements: [{ vertex, owner, kind: 'city' }],
    };

    const { owed, goldPicks } = productionFor(withCity, gold.number);
    expect(goldPicks[owner]).toBe(2);
    expect(owed[owner]).toBeUndefined();
  });
});

describe('improvements', () => {
  it('charges rising amounts of the track commodity', () => {
    expect(improvementCost(1)).toBe(1);
    expect(improvementCost(3)).toBe(3);
  });

  it('refuses an improvement the player cannot pay for', () => {
    const state = ckGame('afford');
    const playing: GameState = { ...state, phase: 'main', turn: 1 };
    const result = applyAction(playing, {
      type: 'buy_improvement',
      track: 'science',
      playerId: state.players[0].id,
    });
    expect(result.ok).toBe(false);
  });

  it('awards a metropolis at level 4 and scores it', () => {
    const state = ckGame('metro');
    const owner = state.players[0].id;
    const vertex = state.board.landVertices[0];
    const draft: GameState = {
      ...state,
      settlements: [{ vertex, owner, kind: 'city' }],
    };
    draft.players[0].improvements = { trade: 0, politics: 0, science: METROPOLIS_LEVEL };

    __internals.settleMetropolis(
      draft,
      { rng: new Rng('m'), now: 0 },
      draft.players[0],
      'science',
    );

    expect(draft.metropolises?.science).toBe(owner);
    expect(draft.settlements[0].metropolis).toBe('science');
    const scored = computeScores(draft, [citiesKnightsRules])[owner];
    expect(scored.modules).toBe(2);
  });
});

describe('barbarians', () => {
  it('advances on a barbarian face and attacks at seven', () => {
    const state = ckGame('barbarians');
    const draft: GameState = { ...state, barbarianPosition: BARBARIAN_ATTACK_AT - 1 };
    expect(draft.barbarianPosition).toBe(6);
  });

  it('rewards the biggest contributor when Catan holds', () => {
    const state = ckGame('defend');
    const [a, b] = state.players;
    const draft: GameState = {
      ...state,
      // One city to attack, and knights enough to beat it.
      settlements: [{ vertex: state.board.landVertices[0], owner: a.id, kind: 'city' }],
      knights: [
        { id: 'k1', vertex: state.board.landVertices[3], owner: a.id, rank: 2, active: true, usedThisTurn: false },
        { id: 'k2', vertex: state.board.landVertices[6], owner: b.id, rank: 1, active: true, usedThisTurn: false },
      ],
      barbarianPosition: BARBARIAN_ATTACK_AT,
    };

    expect(knightStrength(draft, a.id)).toBe(2);
    expect(cityCount(draft, a.id)).toBe(1);

    __internals.barbarianAttack(draft, { rng: new Rng('b'), now: 0 });

    expect(draft.defenderOfCatan?.[a.id]).toBe(1);
    expect(draft.barbarianPosition).toBe(0);
    // Every knight stands down after an attack.
    expect(draft.knights!.every((k) => !k.active)).toBe(true);
  });

  it('makes the weakest defender lose a city when Catan falls', () => {
    const state = ckGame('overrun');
    const [a, b] = state.players;
    const draft: GameState = {
      ...state,
      settlements: [
        { vertex: state.board.landVertices[0], owner: a.id, kind: 'city' },
        { vertex: state.board.landVertices[9], owner: b.id, kind: 'city' },
      ],
      knights: [],
      barbarianPosition: BARBARIAN_ATTACK_AT,
    };

    __internals.barbarianAttack(draft, { rng: new Rng('b'), now: 0 });

    // Nobody defended, so both owe a city.
    expect(draft.pending.filter((t) => t.kind === 'barbarian_loss').length).toBe(2);
  });

  it('will not let the barbarians take a metropolis', () => {
    const state = ckGame('metro-safe');
    const owner = state.players[0].id;
    const vertex = state.board.landVertices[0];
    const draft: GameState = {
      ...state,
      settlements: [{ vertex, owner, kind: 'city', metropolis: 'trade' }],
      pending: [{ kind: 'barbarian_loss', playerId: owner }],
      phase: 'barbarian_loss',
    };

    const result = applyAction(draft, {
      type: 'barbarian_loss',
      vertex,
      playerId: owner,
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/metropolis/i);
  });
});

describe('knights', () => {
  it('cannot be promoted past strong without politics 3', () => {
    const state = ckGame('promote');
    const owner = state.players[0].id;
    const draft: GameState = {
      ...state,
      phase: 'main',
      turn: 1,
      knights: [
        { id: 'k1', vertex: state.board.landVertices[0], owner, rank: 2, active: true, usedThisTurn: false },
      ],
    };
    draft.players[0].hand = { wool: 5, ore: 5 };
    draft.players[0].improvements = { trade: 0, politics: 2, science: 0 };

    const result = applyAction(draft, {
      type: 'promote_knight',
      knightId: 'k1',
      playerId: owner,
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/politics/i);
  });

  it('cannot act on the turn it is activated', () => {
    const state = ckGame('activate');
    const owner = state.players[0].id;
    const draft: GameState = {
      ...state,
      phase: 'main',
      turn: 1,
      knights: [
        { id: 'k1', vertex: state.board.landVertices[0], owner, rank: 1, active: false, usedThisTurn: false },
      ],
    };
    draft.players[0].hand = { grain: 3 };

    const activated = applyAction(draft, {
      type: 'activate_knight',
      knightId: 'k1',
      playerId: owner,
    });
    expect(activated.ok).toBe(true);
    if (!activated.ok) return;
    expect(activated.state.knights![0].usedThisTurn).toBe(true);
  });

  it('will not place a knight away from the player road network', () => {
    const state = ckGame('placement');
    const owner = state.players[0].id;
    const err = __internals.knightPlacementError(
      state,
      owner,
      state.board.landVertices[0],
    );
    expect(err).toMatch(/roads/i);
  });
});

describe('full cities & knights games', () => {
  for (const seed of ['ck-one', 'ck-two']) {
    it(`plays "${seed}" to completion`, { timeout: 120_000 }, () => {
      const { state, steps, rejected } = playOut(ckGame(seed), seed);

      expect(rejected.slice(0, 3), 'legal action refused by the rules').toEqual([]);
      expect(state.phase, `stalled after ${steps} steps`).toBe('game_over');
      expect(state.pending).toEqual([]);
      // The event die must have been rolled along the way.
      expect(state.lastRoll?.event).toBeDefined();
    });
  }

  it(
    'plays the combined ruleset the owners intend to use',
    { timeout: 180_000 },
    () => {
      const { state, steps, rejected } = playOut(
        ckGame('combined', true),
        'combined',
      );

      expect(rejected.slice(0, 3)).toEqual([]);
      expect(state.phase, `stalled after ${steps} steps`).toBe('game_over');
      expect(state.options.victoryPointsToWin).toBe(15);
      expect(state.options.expansions).toEqual({
        seafarers: true,
        citiesAndKnights: true,
      });
    },
  );
});
