/**
 * Send a magic link. Passwordless on purpose: on an iPad, typing a password
 * twice is the single most likely reason someone gives up before playing.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { jsonError } from '@/lib/api';
import { siteUrl } from '@/lib/supabase/env';
import { createServerSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase();
  if (!supabase) {
    return jsonError(
      501,
      'Supabase is not configured on this deployment — play as a guest instead',
    );
  }

  let body: { email?: string; next?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError(400, 'invalid JSON body');
  }

  const email = (body.email ?? '').trim().toLowerCase();
  if (!EMAIL.test(email)) return jsonError(400, 'enter a valid email address');

  // Only same-site paths, so the link cannot be turned into an open redirect.
  const next =
    typeof body.next === 'string' && body.next.startsWith('/') && !body.next.startsWith('//')
      ? body.next
      : '/';

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) return jsonError(400, error.message);

  return NextResponse.json({ ok: true });
}
