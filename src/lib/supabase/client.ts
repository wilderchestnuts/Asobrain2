'use client';

/**
 * Browser Supabase client (anon key only).
 *
 * Returns `null` when Supabase is not configured so that callers degrade to
 * local/guest mode instead of crashing the render.
 */

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from './env';

let cached: SupabaseClient | null = null;

export function getBrowserSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  // One client per tab: each instance starts its own token-refresh timer.
  cached ??= createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return cached;
}
