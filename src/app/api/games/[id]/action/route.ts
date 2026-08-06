/**
 * The only way a game ever changes.
 *
 * One request = one human action + every bot decision that follows from it,
 * committed as a single version bump. Doing the bot turns here (rather than
 * from a timer or the client) means the state a player sees is always one a
 * human is actually waiting on, and there is no half-played turn to recover
 * if a browser closes mid-sequence.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import type { GameAction } from '@/game/actions';
import { gameView, jsonError, mayAct, seatFor } from '@/lib/api';
import { getIdentity, persistIdentity } from '@/lib/auth';
import { appendActions, loadGame, saveState } from '@/lib/db';
import type { ActionLogEntry } from '@/lib/db';
import { apply, runBots, statusFor } from '@/lib/engineBridge';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const identity = await getIdentity();

  let body: { action?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError(400, 'invalid JSON body');
  }

  const incoming = body.action as Partial<GameAction> | undefined;
  if (!incoming || typeof incoming.type !== 'string') {
    return jsonError(400, 'missing action.type');
  }

  const game = await loadGame(id);
  if (!game) return jsonError(404, 'game not found');
  if (!game.state) return jsonError(409, 'game has no state yet');
  if (game.status === 'finished') return jsonError(409, 'game is over');
  if (game.status === 'lobby') return jsonError(409, 'game has not started');

  const seat = seatFor(game, identity);
  if (!seat) return jsonError(403, 'you do not hold a seat in this game');
  if (seat.isBot) return jsonError(403, 'that seat is played by a bot');

  // The client's playerId is decoration; the seat is the truth. Overwriting it
  // is what makes forging another player's move impossible.
  const action = { ...incoming, playerId: seat.playerId } as GameAction;

  if (!mayAct(game.state, seat.playerId, action)) {
    return jsonError(409, 'not your turn');
  }

  const result = apply(game.state, action);
  if (!result.ok) return jsonError(422, result.error);

  const seatOf = (playerId: string) =>
    game.seats.find((s) => s.playerId === playerId)?.seat ?? null;
  const { state, steps } = runBots(result.state, seatOf);

  const status = statusFor(state);
  const saved = await saveState({
    gameId: id,
    expectedVersion: game.version,
    state,
    status,
  });

  if (!saved.ok) {
    // Somebody else's move landed first. The client refetches rather than
    // retrying, because the action it wanted may no longer be legal.
    return jsonError(saved.reason === 'missing' ? 404 : 409, saved.reason, {
      version: game.version,
    });
  }

  const log: ActionLogEntry[] = [
    { seat: seat.seat, action, appliedVersion: saved.version },
    ...steps.map((s) => ({
      seat: s.seat,
      action: s.action,
      appliedVersion: saved.version,
    })),
  ];
  await appendActions(id, log);

  const view = gameView(
    { ...game, state, version: saved.version, status },
    identity,
  );
  return persistIdentity(
    NextResponse.json({ ...view, botActions: steps.length }),
    identity,
  );
}
