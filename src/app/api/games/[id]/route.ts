import { NextResponse } from 'next/server';

import { gameView, jsonError, seatFor } from '@/lib/api';
import { getIdentity, persistIdentity } from '@/lib/auth';
import { loadGame } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const identity = await getIdentity();

  const game = await loadGame(id);
  if (!game) return jsonError(404, 'game not found');

  // A game still in its lobby is readable by anyone holding the link — that
  // link *is* the invite. Once play starts, only the players (or spectators of
  // an explicitly public game) may look.
  const seat = seatFor(game, identity);
  const isPublic = game.options?.isPublic === true;
  if (!seat && !isPublic && game.status !== 'lobby') {
    return jsonError(403, 'not a participant');
  }

  return persistIdentity(NextResponse.json(gameView(game, identity)), identity);
}
