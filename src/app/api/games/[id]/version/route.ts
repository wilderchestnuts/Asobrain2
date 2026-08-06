import { NextResponse } from 'next/server';

import { jsonError } from '@/lib/api';
import { loadGameMeta } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Cheap poll target for when the websocket is down. No game data. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const meta = await loadGameMeta(id);
  if (!meta) return jsonError(404, 'game not found');
  return NextResponse.json(meta, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
