/**
 * Refreshes the Supabase session on every request.
 *
 * Without this, an access token that expires while an iPad is asleep is never
 * renewed and the next action comes back 401 — the session has to be refreshed
 * somewhere that can write cookies, and this is the only place that runs before
 * every render.
 *
 * Next 16 renamed the `middleware` convention to `proxy`; the runtime is
 * always nodejs here, which suits Supabase's cookie handling fine.
 *
 * The public env vars are read inline rather than imported so that nothing
 * server-secret can be pulled into this bundle.
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { isUsableSupabaseUrl } from '@/lib/supabase/env';

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )?.trim();

  // Local/guest mode: no Supabase, nothing to refresh.
  if (!url || !key) return NextResponse.next({ request });

  // A malformed URL makes the Supabase constructor throw, and this runs on
  // every request — so one mistyped variable would return an error page for the
  // entire site, including /api/health. Refreshing the session is an
  // optimisation; never let it take the app down.
  if (!isUsableSupabaseUrl(url)) {
    console.warn(
      `[proxy] NEXT_PUBLIC_SUPABASE_URL is not a valid URL ("${url.slice(0, 60)}"). ` +
        'Skipping session refresh; see /api/health.',
    );
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // Responses that set auth cookies must never be cached by a CDN.
        for (const [header, value] of Object.entries(headers ?? {})) {
          response.headers.set(header, value);
        }
      },
    },
  });

  try {
    await supabase.auth.getUser();
  } catch (err) {
    // A bad key or an unreachable project should degrade to "signed out", not
    // break every route on the site.
    console.warn('[proxy] session refresh failed:', (err as Error).message);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image optimisation, which never
     * carry a session and would only add latency.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)',
  ],
};
