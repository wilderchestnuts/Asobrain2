/**
 * The one place the multiplayer plumbing touches the pure engine.
 *
 * Everything the API routes need from src/game/ goes through here, so a change
 * in the engine's shape is a one-file fix rather than a hunt through route
 * handlers.
 */

import type { GameAction } from '@/game/actions';
import { chooseAction } from '@/game/ai';
import { applyAction } from '@/game/reducer';
import { redactFor } from '@/game/redact';
import { rngFor } from '@/game/rng';
import { createGame } from '@/game/setup';
import type { GameOptions, GameState, PlayerId } from '@/game/types';

import type { GameStatus } from './db';

/** Guards against a bot policy that never reaches `end_turn`. */
const MAX_BOT_STEPS = 400;

export interface AppliedStep {
  action: GameAction;
  seat: number | null;
}

const ctxFor = (state: GameState) => ({
  rng: rngFor(state.options.seed, state.rngCursor ?? 0),
  now: Date.now(),
});

export function apply(
  state: GameState,
  action: GameAction,
): { ok: true; state: GameState } | { ok: false; error: string } {
  return applyAction(state, action, ctxFor(state));
}

export function redact(state: GameState, playerId: PlayerId | null): GameState {
  // A spectator (or a lobby list) gets the same treatment as an unknown
  // player: everything hidden.
  return redactFor(state, playerId ?? '__spectator__');
}

export const statusFor = (state: GameState): GameStatus =>
  state.phase === 'game_over' || state.winner ? 'finished' : 'active';

/**
 * Whichever bot is currently blocking play, or null if the game is waiting on
 * a human. Pending obligations (discards, barbarian losses) come first because
 * they block the turn even when it is not that player's turn.
 */
function nextBotActor(state: GameState): PlayerId | null {
  if (state.phase === 'game_over' || state.winner) return null;

  const byId = (id: PlayerId) => state.players.find((p) => p.id === id);

  const pending = state.pending?.[0];
  if (pending) {
    const owed = byId(pending.playerId);
    return owed?.isBot ? owed.id : null;
  }

  const trade = state.activeTrade;
  if (trade) {
    const audience =
      trade.to.length > 0
        ? trade.to
        : state.players.filter((p) => p.id !== trade.from).map((p) => p.id);
    const undecided = audience.find(
      (id) => !trade.accepted.includes(id) && !trade.rejected.includes(id),
    );
    if (undecided) {
      const p = byId(undecided);
      return p?.isBot ? p.id : null;
    }
    // The offering player has to resolve their own offer before anyone else
    // can move, so fall through to the current-player check.
  }

  const current = state.players[state.currentPlayer];
  return current?.isBot ? current.id : null;
}

/**
 * Play out every consecutive bot decision in the same request, so the client
 * gets one push containing a settled board rather than watching four bots
 * trickle in.
 */
export function runBots(
  start: GameState,
  seatOf: (playerId: PlayerId) => number | null,
): { state: GameState; steps: AppliedStep[] } {
  let state = start;
  const steps: AppliedStep[] = [];

  for (let i = 0; i < MAX_BOT_STEPS; i++) {
    const actor = nextBotActor(state);
    if (!actor) break;

    const chosen = chooseAction(state, actor);
    if (!chosen) break;

    // Never trust a policy to fill this in correctly either.
    const action = { ...chosen, playerId: actor } as GameAction;
    const result = apply(state, action);
    if (!result.ok) {
      // A bot proposing an illegal move is a bug in the policy, not something
      // the human should be blocked by: stop here and let play continue.
      console.error(
        `bot ${actor} proposed illegal ${action.type}: ${result.error}`,
      );
      break;
    }

    state = result.state;
    steps.push({ action, seat: seatOf(actor) });
  }

  return { state, steps };
}

// ---------------------------------------------------------------------------
// Game creation
// ---------------------------------------------------------------------------

export interface SeatSpec {
  playerId: string;
  name: string;
  color: string;
  isBot: boolean;
  botDifficulty?: 'easy' | 'normal' | 'hard';
  userId?: string;
}

/**
 * A fresh game. The engine owns board layout, the dev deck and the opening
 * phase; all this adds is the database's id and its seat numbering.
 */
export function createInitialState(
  id: string,
  options: GameOptions,
  seats: SeatSpec[],
): GameState {
  return createGame({
    id,
    options,
    players: seats.map((s) => ({
      id: s.playerId,
      name: s.name,
      color: s.color,
      isBot: s.isBot,
      botDifficulty: s.botDifficulty,
      userId: s.userId,
    })),
  });
}
