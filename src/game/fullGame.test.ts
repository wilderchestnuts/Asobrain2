/**
 * End-to-end engine tests: play complete games and assert the invariants that
 * must hold at every single step.
 *
 * Unit tests catch wrong rules; this catches the things that only show up in
 * combination — a phase that never resolves, a supply that goes negative, a
 * pending queue that never drains, a game that cannot reach a winner. Every
 * game runs from a fixed seed, so any failure here is exactly reproducible.
 */

import { describe, expect, it } from 'vitest';
import { applyAction, allLegalActions } from './reducer';
import { createGame } from './setup';
import { Rng } from './rng';
import { totalCards } from './hand';
import { computeScores } from './scoring';
import { STARTING_SUPPLY } from './setup';
import { ALL_TRADEABLES } from './hand';
import { BANK_STOCK_PER_RESOURCE } from './legal';
import type { GameAction } from './actions';
import type { GameState } from './types';

const SEATS = [
  { name: 'Alice', color: '#c1121f', isBot: false },
  { name: 'Bob', color: '#118ab2', isBot: false },
  { name: 'Bot', color: '#f4a261', isBot: true },
];

const newGame = (seed: string, overrides = {}) =>
  createGame({
    players: SEATS,
    options: { seed, ...overrides },
    id: `test-${seed}`,
    now: 0,
  });

/**
 * Pick a legal action, weighted so games actually progress. A uniform choice
 * stalls: `end_turn` and trade offers vastly outnumber building actions, so
 * nobody ever accumulates enough to win.
 */
function chooseWeighted(state: GameState, rng: Rng): GameAction | null {
  const legal = allLegalActions(state, state.players[state.currentPlayer].id);
  if (legal.length === 0) return null;

  const weightOf = (a: GameAction): number => {
    switch (a.type) {
      case 'build_city':
        return 40;
      case 'build_settlement':
        return 30;
      case 'buy_dev_card':
        return 8;
      case 'build_road':
      case 'build_ship':
        return 6;
      case 'play_dev_card':
        return 5;
      case 'bank_trade':
        return 4;
      case 'roll':
        return 100;
      case 'end_turn':
        return 3;
      // Player-to-player trade needs another player to answer; in a random
      // driver it just churns, so keep it rare but non-zero for coverage.
      case 'offer_trade':
        return 1;
      default:
        // Anything the rules are blocked on (discard, robber, steal, gold)
        // must be taken immediately or the game deadlocks.
        return 500;
    }
  };

  const total = legal.reduce((s, a) => s + weightOf(a), 0);
  let roll = rng.float() * total;
  for (const a of legal) {
    roll -= weightOf(a);
    if (roll <= 0) return a;
  }
  return legal[legal.length - 1];
}

interface PlayResult {
  state: GameState;
  steps: number;
  rejected: { action: GameAction; error: string }[];
}

function playGame(seed: string, maxSteps = 20000, overrides = {}): PlayResult {
  let state = newGame(seed, overrides);
  const rng = new Rng(`driver-${seed}`);
  const rejected: { action: GameAction; error: string }[] = [];
  let steps = 0;

  while (state.phase !== 'game_over' && steps < maxSteps) {
    // Whoever the rules are waiting on acts next; otherwise the current player.
    const blocked = state.pending.find((t) => t.kind !== 'resume')
      ?.playerId;
    const actor = blocked ?? state.players[state.currentPlayer].id;
    const legal = allLegalActions(state, actor);
    if (legal.length === 0) break;

    const action = blocked
      ? legal[rng.int(legal.length)]
      : (chooseWeighted(state, rng) ?? legal[rng.int(legal.length)]);

    // A fixed clock keeps log timestamps out of the replay comparison; `now`
    // is injected precisely so the reducer has no ambient time dependency.
    const result = applyAction(state, { ...action, playerId: actor }, { now: steps });
    if (result.ok) {
      state = result.state;
      checkInvariants(state);
      checkPieceInvariants(state);
    } else {
      // A legal action being rejected means legal.ts and base.ts disagree,
      // which is exactly the bug class this test exists to catch.
      rejected.push({ action, error: result.error });
    }
    steps++;
  }

  return { state, steps, rejected };
}

/** Assertions that must hold after every single applied action. */
function checkInvariants(state: GameState): void {
  /*
   * Nobody may be asked for something they cannot give.
   *
   * A pending task with no legal answer wedges the game permanently — the
   * player it names can never act, and nobody else may act either. This is how
   * a real game got stuck: the barbarians demanded a city from a player whose
   * only cities were metropolises, which cannot be destroyed.
   */
  for (const task of state.pending) {
    if (task.kind === 'resume') continue;
    const options = allLegalActions(state, task.playerId);
    expect(
      options.length,
      `"${task.kind}" is owed by ${task.playerId} but they have no legal move`,
    ).toBeGreaterThan(0);
  }
}

function checkPieceInvariants(state: GameState): void {
  for (const p of state.players) {
    for (const [k, n] of Object.entries(p.hand)) {
      expect(n, `${p.name} has negative ${k}`).toBeGreaterThanOrEqual(0);
    }
    expect(p.supply.roads).toBeGreaterThanOrEqual(0);
    expect(p.supply.settlements).toBeGreaterThanOrEqual(0);
    expect(p.supply.cities).toBeGreaterThanOrEqual(0);
  }

  // No two pieces may occupy the same vertex or edge.
  const vertices = state.settlements.map((s) => s.vertex);
  expect(new Set(vertices).size, 'duplicate settlement vertex').toBe(
    vertices.length,
  );
  const edges = state.roads.map((r) => r.edge);
  expect(new Set(edges).size, 'duplicate road edge').toBe(edges.length);

  // The bank cannot go negative: cards in hands plus cards on the table must
  // never exceed what the box contains.
  for (const res of ALL_TRADEABLES) {
    const held = state.players.reduce((s, p) => s + (p.hand[res] ?? 0), 0);
    if (['brick', 'lumber', 'wool', 'grain', 'ore'].includes(res)) {
      expect(held, `bank oversubscribed on ${res}`).toBeLessThanOrEqual(
        BANK_STOCK_PER_RESOURCE,
      );
    }
  }

  expect(state.rngCursor).toBeGreaterThanOrEqual(0);
}

describe('full games', () => {
  const seeds = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];

  for (const seed of seeds) {
    it(`plays "${seed}" to a winner without breaking an invariant`, () => {
      const { state, steps, rejected } = playGame(seed);

      expect(
        rejected.slice(0, 3),
        'legal.ts offered an action base.ts refused',
      ).toEqual([]);
      expect(state.phase, `game stalled after ${steps} steps`).toBe('game_over');
      expect(state.winner).toBeDefined();

      const winner = state.players.find((p) => p.id === state.winner);
      expect(winner).toBeDefined();
      const scores = computeScores(state);
      expect(scores[state.winner!].total).toBeGreaterThanOrEqual(
        state.options.victoryPointsToWin,
      );
    });
  }

  it('never leaves the pending queue permanently blocked', () => {
    const { state } = playGame('pending-check');
    expect(state.pending).toEqual([]);
  });

  it('is deterministic: the same seed replays identically', () => {
    const a = playGame('replay');
    const b = playGame('replay');
    expect(a.state.winner).toBe(b.state.winner);
    expect(a.state.turn).toBe(b.state.turn);
    expect(a.state.rngCursor).toBe(b.state.rngCursor);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
  });

  it('rejects actions from a player who is not to move', () => {
    const state = newGame('turn-order');
    const notCurrent = state.players[(state.currentPlayer + 1) % 3];
    const result = applyAction(state, {
      type: 'end_turn',
      playerId: notCurrent.id,
    });
    expect(result.ok).toBe(false);
  });

  it('never mutates the state passed in', () => {
    const state = newGame('immutable');
    const before = JSON.stringify(state);
    const actor = state.players[state.currentPlayer].id;
    const legal = allLegalActions(state, actor);
    for (const action of legal.slice(0, 5)) {
      applyAction(state, { ...action, playerId: actor });
    }
    expect(JSON.stringify(state)).toBe(before);
  });

  it('keeps every player within their piece supply', () => {
    const { state } = playGame('supply');
    for (const p of state.players) {
      const settlements = state.settlements.filter(
        (s) => s.owner === p.id && s.kind === 'settlement',
      ).length;
      const cities = state.settlements.filter(
        (s) => s.owner === p.id && s.kind === 'city',
      ).length;
      expect(settlements).toBeLessThanOrEqual(STARTING_SUPPLY.settlements);
      expect(cities).toBeLessThanOrEqual(STARTING_SUPPLY.cities);
      expect(settlements + p.supply.settlements).toBe(
        STARTING_SUPPLY.settlements,
      );
      expect(cities + p.supply.cities).toBe(STARTING_SUPPLY.cities);
    }
  });

  it('hands out the opening resources only for the second settlement', () => {
    let state = newGame('opening');
    expect(state.phase).toBe('setup_first');
    for (const p of state.players) expect(totalCards(p.hand)).toBe(0);

    // Play out the whole snake draft.
    let guard = 0;
    while (
      (state.phase === 'setup_first' || state.phase === 'setup_second') &&
      guard++ < 200
    ) {
      const actor = state.players[state.currentPlayer].id;
      const legal = allLegalActions(state, actor);
      if (legal.length === 0) break;
      const result = applyAction(state, { ...legal[0], playerId: actor });
      if (!result.ok) break;
      state = result.state;
    }

    expect(state.phase).toBe('roll');
    expect(state.settlements.length).toBe(6);
    expect(state.settlements.every((s) => s.kind === 'settlement')).toBe(true);
    // Everyone gets the yield from their second settlement, though a settlement
    // ringed by desert and sea legitimately yields nothing.
    const totals = state.players.map((p) => totalCards(p.hand));
    expect(totals.some((t) => t > 0)).toBe(true);
    for (const t of totals) expect(t).toBeLessThanOrEqual(3);
  });
});
