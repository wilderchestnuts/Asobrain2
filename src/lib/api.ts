/**
 * Shared bits for the API routes: response helpers, seat resolution, and the
 * one payload shape every game endpoint returns.
 */

import { NextResponse } from 'next/server';

import type { GameAction } from '@/game/actions';
import type { GameState, PlayerId } from '@/game/types';

import type { Identity } from './auth';
import type { GameRecord, SeatRecord } from './db';
import { redact } from './engineBridge';

export const jsonError = (status: number, error: string, extra?: object) =>
  NextResponse.json({ error, ...extra }, { status });

/** The seat this caller owns in this game, if any. */
export function seatFor(
  game: GameRecord,
  identity: Identity,
): SeatRecord | null {
  return (
    game.seats.find((s) =>
      identity.userId
        ? s.userId === identity.userId
        : Boolean(s.guestId) && s.guestId === identity.guestId,
    ) ?? null
  );
}

/** Seats nobody has claimed yet and that are not played by a bot. */
export const openSeats = (game: GameRecord): SeatRecord[] =>
  game.seats.filter((s) => !s.isBot && !s.userId && !s.guestId);

export interface GameView {
  id: string;
  status: GameRecord['status'];
  version: number;
  options: Record<string, unknown>;
  seats: Array<{
    seat: number;
    playerId: string;
    name: string;
    color: string;
    isBot: boolean;
    botDifficulty: string | null;
    claimed: boolean;
  }>;
  you: { seat: number | null; playerId: string | null; kind: Identity['kind'] };
  state: GameState | null;
}

/** The redacted, per-caller view of a game. Never leaks another hand. */
export function gameView(game: GameRecord, identity: Identity): GameView {
  const seat = seatFor(game, identity);
  return {
    id: game.id,
    status: game.status,
    version: game.version,
    options: game.options,
    seats: game.seats.map((s) => ({
      seat: s.seat,
      playerId: s.playerId,
      name: s.name,
      color: s.color,
      isBot: s.isBot,
      botDifficulty: s.botDifficulty,
      claimed: Boolean(s.userId || s.guestId || s.isBot),
    })),
    you: {
      seat: seat?.seat ?? null,
      playerId: seat?.playerId ?? null,
      kind: identity.kind,
    },
    state: game.state ? redact(game.state, seat?.playerId ?? null) : null,
  };
}

/**
 * May this player act right now?
 *
 * The reducer is the real authority — this only rejects the obvious
 * out-of-turn case early, before we bother loading rules. It stays lenient
 * about anything owed off-turn (discards, trade responses) so it can never
 * block a move the rules would have allowed.
 */
export function mayAct(
  state: GameState,
  playerId: PlayerId,
  action: GameAction,
): boolean {
  if (action.type === 'resign') return true;

  if (state.pending?.length) {
    return state.pending.some((p) => p.playerId === playerId);
  }

  if (state.activeTrade) {
    const t = state.activeTrade;
    if (t.from === playerId) return true;
    if (t.to.length === 0 || t.to.includes(playerId)) return true;
  }

  return state.players[state.currentPlayer]?.id === playerId;
}
