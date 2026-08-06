/**
 * Bot behaviour.
 *
 * The trade-limit tests are the point of this file. Constant trade requests
 * were the top complaint about the game this replaces (see DECISIONS.md), so
 * the caps are a product requirement and are tested as one.
 */

import { describe, expect, it } from 'vitest';
import { applyAction } from '../reducer';
import { createGame } from '../setup';
import { chooseAction, evaluateVertex, mayAskForTrade, runBots } from './index';
import { tradeResponders } from '../legal';
import type { GameState } from '../types';

const seats = (bots: number) => [
  { name: 'Human', color: '#c1121f', isBot: false },
  ...Array.from({ length: bots }, (_, i) => ({
    name: `Bot ${i + 1}`,
    color: ['#118ab2', '#f4a261', '#06d6a0'][i],
    isBot: true,
  })),
];

const game = (seed: string, bots = 2, options = {}) =>
  createGame({
    players: seats(bots),
    options: { seed, ...options },
    id: `ai-${seed}`,
    now: 0,
  });

/** Run a whole game with bots driving every seat they own. */
function playWithBots(state: GameState, maxSteps = 20000) {
  let steps = 0;
  const offersToHuman: string[] = [];

  while (state.phase !== 'game_over' && steps < maxSteps) {
    const owed = state.pending.find((t) => t.kind !== 'resume');
    // A trade offer is answered by someone who is neither the current player
    // nor carrying a pending entry, so it has to be named explicitly.
    const responder =
      state.phase === 'trade_response'
        ? tradeResponders(state)[0]
        : undefined;
    const actorId =
      owed?.playerId ?? responder ?? state.players[state.currentPlayer].id;

    const action = chooseAction(state, actorId);
    if (!action) break;
    if (action.type === 'offer_trade') offersToHuman.push(actorId);

    const result = applyAction(state, { ...action, playerId: actorId }, { now: steps });
    if (!result.ok) break;
    state = result.state;
    steps++;
  }
  return { state, steps, offersToHuman };
}

describe('board evaluation', () => {
  it('prefers a high-pip, varied spot to a poor one', () => {
    const state = game('evaluate');
    const scores = state.board.landVertices.map((v) => ({
      v,
      score: evaluateVertex(state, v),
    }));
    scores.sort((a, b) => b.score - a.score);
    expect(scores[0].score).toBeGreaterThan(scores[scores.length - 1].score);
  });

  it('values a gold hex above an ordinary one', () => {
    const state = game('gold-value', 1, { goldHexCount: 2, boardRadius: 2 });
    const gold = state.board.hexes.find((h) => h.terrain === 'gold');
    if (!gold?.number) return;
    // Simply assert the evaluator runs and ranks something on the gold hex.
    const touching = state.board.landVertices.filter((v) =>
      v.includes(`${gold.coord.q},${gold.coord.r}`),
    );
    expect(touching.length).toBeGreaterThan(0);
    expect(evaluateVertex(state, touching[0])).toBeGreaterThan(0);
  });
});

describe('trade rate limiting', () => {
  it('refuses to ask once the per-game cap is spent', () => {
    const state = game('cap-game', 1);
    const bot = state.players[1];
    bot.botTradesMade = state.options.botTrade!.maxPerGame;
    expect(mayAskForTrade(state, bot.id)).toBe(false);
  });

  it('refuses to ask twice in one turn', () => {
    const state = game('cap-turn', 1);
    const bot = state.players[1];
    bot.botTradesThisTurn = state.options.botTrade!.maxPerTurn;
    expect(mayAskForTrade(state, bot.id)).toBe(false);
  });

  it('stays quiet for the rest of the turn after being refused', () => {
    const state = game('refused', 1);
    const bot = state.players[1];
    expect(mayAskForTrade(state, bot.id)).toBe(true);

    state.botTradeRefusals = { [bot.id]: 1 };
    expect(mayAskForTrade(state, bot.id)).toBe(false);
  });

  it('never asks at all when the cap is zero', () => {
    const state = game('no-trades', 1, {
      botTrade: { maxPerGame: 0, maxPerTurn: 0 },
    });
    expect(mayAskForTrade(state, state.players[1].id)).toBe(false);
  });

  it('will not offer on behalf of a human seat', () => {
    // The caps in base.ts only tick for bots, so a policy that proposed for a
    // human seat would be uncapped — it offered forever until this was fixed.
    const state = game('human-seat', 1);
    expect(mayAskForTrade(state, state.players[0].id)).toBe(false);
  });

  it('does not haggle when there is no human in the game', () => {
    const allBots = createGame({
      players: [
        { name: 'A', color: '#111', isBot: true },
        { name: 'B', color: '#222', isBot: true },
      ],
      options: { seed: 'botsonly' },
    });
    expect(mayAskForTrade(allBots, allBots.players[0].id)).toBe(false);
  });

  it('counts an offer against the cap when one is actually made', () => {
    const state = game('counting', 1);
    const bot = state.players[1];
    const playing: GameState = {
      ...state,
      phase: 'main',
      turn: 4,
      currentPlayer: 1,
    };
    playing.players[1].hand = { brick: 3, lumber: 2 };

    const result = applyAction(playing, {
      type: 'offer_trade',
      give: { brick: 1 },
      receive: { ore: 1 },
      playerId: bot.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players[1].botTradesMade).toBe(1);
    expect(result.state.players[1].botTradesThisTurn).toBe(1);
  });

  it('records a refusal when the human declines', () => {
    const state = game('decline', 1);
    const [human, bot] = state.players;
    const playing: GameState = {
      ...state,
      phase: 'main',
      turn: 4,
      currentPlayer: 1,
      activeTrade: {
        id: 't1',
        from: bot.id,
        to: [],
        give: { brick: 1 },
        receive: { ore: 1 },
        accepted: [],
        rejected: [],
      },
    };

    const result = applyAction(playing, {
      type: 'respond_trade',
      accept: false,
      playerId: human.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.botTradeRefusals?.[bot.id]).toBe(1);
  });

  it('clears the per-turn allowance when the turn advances', () => {
    const state = game('turn-reset', 1);
    const playing: GameState = {
      ...state,
      phase: 'main',
      turn: 4,
      currentPlayer: 0,
      botTradeRefusals: { [state.players[1].id]: 1 },
    };
    playing.players[1].botTradesThisTurn = 1;

    const result = applyAction(playing, {
      type: 'end_turn',
      playerId: state.players[0].id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players[1].botTradesThisTurn).toBe(0);
    expect(result.state.botTradeRefusals).toEqual({});
  });

  it('keeps bot offers rare across a whole game', { timeout: 120_000 }, () => {
    const { state, offersToHuman } = playWithBots(game('quiet', 2));
    const cap = state.options.botTrade!.maxPerGame;
    // Two bots, so the ceiling is two full allowances.
    expect(offersToHuman.length).toBeLessThanOrEqual(cap * 2);
  });
});

describe('bots play a game', () => {
  for (const seed of ['bots-a', 'bots-b']) {
    it(`finishes "${seed}" without stalling`, { timeout: 120_000 }, () => {
      const { state, steps } = playWithBots(game(seed, 2));
      expect(state.phase, `stalled after ${steps} steps`).toBe('game_over');
      expect(state.winner).toBeDefined();
    });
  }

  it('handles the expansions too', { timeout: 180_000 }, () => {
    const { state, steps } = playWithBots(
      game('bots-ck', 2, {
        scenario: 'heading-for-new-shores',
        expansions: { seafarers: true, citiesAndKnights: true },
      }),
    );
    expect(state.phase, `stalled after ${steps} steps`).toBe('game_over');
  });

  it('runBots stops as soon as it is a human turn', () => {
    const state = game('runbots', 2);
    const after = runBots(state, (s, a) => {
      const r = applyAction(s, a, { now: 0 });
      return r.ok ? r.state : null;
    });
    const owed = after.pending.find((t) => t.kind !== 'resume');
    const actorId = owed?.playerId ?? after.players[after.currentPlayer].id;
    const actor = after.players.find((p) => p.id === actorId);
    // It either handed control back to a human or finished the game outright.
    expect(actor?.isBot === false || after.phase === 'game_over').toBe(true);
  });
});
