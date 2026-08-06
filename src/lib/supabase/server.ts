/**
 * Server-side Supabase client bound to the request's cookies.
 *
 * Uses the modern `getAll`/`setAll` cookie API — the deprecated
 * `get`/`set`/`remove` trio drops edge cases and breaks token refresh.
 *
 * This client carries the *user's* identity (anon key + session cookie), so it
 * is what we use to answer "who is calling?". Authoritative writes use the
 * service-role client instead.
 */

import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from './env';

export async function createServerSupabase(): Promise<SupabaseClient | null> {
  if (!isSupabaseConfigured()) return null;

  const store = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            store.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. Harmless: the proxy
          // refreshes the session on every request, so the write is redundant
          // there rather than lost.
        }
      },
    },
  });
}
