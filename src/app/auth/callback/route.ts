/**
 * Magic-link landing point.
 *
 * Supabase sends people here with either a PKCE `code` (the default for the
 * SSR client) or a `token_hash` + `type` pair (the older email template).
 * Handling both means a project created from any template works without the
 * owner having to edit email templates in the dashboard.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';

import { createServerSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;

  const rawNext = url.searchParams.get('next') ?? '/';
  const next =
    rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';

  const supabase = await createServerSupabase();
  if (!supabase) {
    return NextResponse.redirect(new URL('/?auth=unconfigured', url.origin));
  }

  const error = code
    ? (await supabase.auth.exchangeCodeForSession(code)).error
    : tokenHash && type
      ? (await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error
      : { message: 'missing code' };

  if (error) {
    return NextResponse.redirect(
      new URL(
        `/?auth=error&reason=${encodeURIComponent(error.message)}`,
        url.origin,
      ),
    );
  }

  // Session cookies were written by the client's setAll during the exchange.
  return NextResponse.redirect(new URL(next, url.origin));
}
