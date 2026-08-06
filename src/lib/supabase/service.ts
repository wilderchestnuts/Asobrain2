/**
 * Service-role Supabase client. Bypasses RLS, so it is the only thing allowed
 * to write `games.state` — and it must never be imported from a client
 * component. Every caller lives under src/app/api or src/lib and runs on the
 * server; `serviceRoleKey()` throws if that is ever violated.
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

import { SUPABASE_URL, isUsableSupabaseUrl } from './env';

/**
 * Read through a function rather than a module constant, with a loud tripwire
 * if this ever executes in a browser. Supabase renamed these keys mid-2025, so
 * accept either spelling.
 */
export function serviceRoleKey(): string {
  if (typeof window !== 'undefined') {
    throw new Error('serviceRoleKey() must never be called in the browser');
  }
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    ''
  );
}

/** Whether API routes can do authoritative writes against Postgres. */
export const isServerSupabaseConfigured = (): boolean =>
  Boolean(isUsableSupabaseUrl() && serviceRoleKey());

let cached: SupabaseClient | null = null;

/** `null` when the server is running without Supabase (local mode). */
export function getServiceSupabase(): SupabaseClient | null {
  if (!isServerSupabaseConfigured()) return null;
  cached ??= createClient(SUPABASE_URL, serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
