import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { gameView, jsonError, seatFor } from '@/lib/api';
import { getIdentity, persistIdentity } from '@/lib/auth';
import { deleteGame, loadGame } from '@/lib/db';

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

/**
 * Delete a game.
 *
 * Only someone holding a seat may do it. There is no soft-delete: these are
 * casual games between two people, and a list that keeps its own tombstones
 * would be worse than the clutter it replaced.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const identity = await getIdentity();
  const game = await loadGame(id);
  if (!game) return jsonError(404, 'no such game');

  if (!seatFor(game, identity)) {
    return jsonError(403, 'only a player in this game can delete it');
  }

  await deleteGame(id);
  return persistIdentity(NextResponse.json({ ok: true }), identity);
}
