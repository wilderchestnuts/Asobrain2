import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import type { GameState } from '@/game/types';
import { gameView, jsonError, openSeats, seatFor } from '@/lib/api';
import { getIdentity, persistIdentity, setGuestName } from '@/lib/auth';
import { appendActions, claimSeat, loadGame, saveState } from '@/lib/db';
import type { GameRecord } from '@/lib/db';
import { runBots, statusFor } from '@/lib/engineBridge';

export const dynamic = 'force-dynamic';

/** Mirror the seat table into the stored state, which is what clients render. */
function withSeatApplied(
  state: GameState,
  playerId: string,
  name: string,
  userId: string | null,
): GameState {
  return {
    ...state,
    players: state.players.map((p) =>
      p.id === playerId
        ? {
            ...p,
            name,
            isBot: false,
            botDifficulty: undefined,
            userId: userId ?? undefined,
          }
        : p,
    ),
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const identity = await getIdentity();

  let body: { seat?: number; name?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  let game: GameRecord | null = await loadGame(id);
  if (!game) return jsonError(404, 'game not found');

  const existing = seatFor(game, identity);
  if (existing) {
    return persistIdentity(NextResponse.json(gameView(game, identity)), identity);
  }

  const name =
    (typeof body.name === 'string' && body.name.trim().slice(0, 40)) ||
    identity.displayName;

  // One retry: a conflict here means the other human joined a heartbeat
  // earlier, and the seat we picked may already be gone.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!game) return jsonError(404, 'game not found');
    const current: GameRecord = game;

    const open = openSeats(current);
    const target =
      typeof body.seat === 'number'
        ? open.find((s) => s.seat === body.seat)
        : open[0];
    if (!target) return jsonError(409, 'no free seats');

    await claimSeat({ gameId: id, seat: target.seat, identity, name });

    if (!current.state) {
      const fresh = await loadGame(id);
      return persistIdentity(
        NextResponse.json(gameView(fresh ?? current, identity)),
        identity,
      );
    }

    const stillOpen = open.filter((s) => s.seat !== target.seat).length;
    let state = withSeatApplied(
      current.state,
      target.playerId,
      name,
      identity.userId,
    );

    let status = current.status;
    let botSteps: Array<{ action: unknown; seat: number | null }> = [];
    if (status === 'lobby' && stillOpen === 0) {
      const seatOf = (playerId: string) =>
        current.seats.find((s) => s.playerId === playerId)?.seat ?? null;
      const played = runBots(state, seatOf);
      state = played.state;
      botSteps = played.steps;
      status = statusFor(state);
    }

    const saved = await saveState({
      gameId: id,
      expectedVersion: current.version,
      state,
      status,
    });

    if (saved.ok) {
      if (botSteps.length) {
        await appendActions(
          id,
          botSteps.map((s) => ({
            seat: s.seat,
            action: s.action,
            appliedVersion: saved.version,
          })),
        );
      }
      const fresh = await loadGame(id);
      const res = NextResponse.json(
        gameView(
          fresh ?? { ...current, state, status, version: saved.version },
          identity,
        ),
      );
      persistIdentity(res, identity);
      if (identity.kind === 'guest') setGuestName(res, name);
      return res;
    }

    game = await loadGame(id);
  }

  return jsonError(409, 'conflict');
}
