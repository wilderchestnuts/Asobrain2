/**
 * Who am I, and can this deployment talk to Supabase at all? The UI uses the
 * second half to decide whether to offer sign-in or go straight to guest play.
 */

import { NextResponse } from 'next/server';

import { getIdentity, persistIdentity, setGuestName } from '@/lib/auth';
import { isRemoteDb } from '@/lib/db';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const dynamic = 'force-dynamic';

export async function GET() {
  const identity = await getIdentity();
  return persistIdentity(
    NextResponse.json({
      kind: identity.kind,
      id: identity.key,
      displayName: identity.displayName,
      authAvailable: isSupabaseConfigured(),
      persistent: isRemoteDb(),
    }),
    identity,
  );
}

/** Guests rename themselves without an account. */
export async function POST(req: Request) {
  const identity = await getIdentity();
  let name = '';
  try {
    const body = (await req.json()) as { displayName?: string };
    name = (body.displayName ?? '').trim();
  } catch {
    // fall through to the validation below
  }
  if (!name) {
    return NextResponse.json({ error: 'displayName required' }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true, displayName: name.slice(0, 40) });
  persistIdentity(res, identity);
  return setGuestName(res, name);
}
