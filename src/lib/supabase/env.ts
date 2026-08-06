/**
 * Supabase configuration, resolved defensively.
 *
 * The app has to boot and be playable *before* anyone has created a Supabase
 * project — the owner runs it locally first. So nothing here throws on missing
 * env vars; callers ask `isSupabaseConfigured()` and fall back to local mode.
 *
 * NEXT_PUBLIC_* names are written out literally rather than looked up
 * dynamically, because Next.js inlines them at build time by textual match.
 */

/** Public project URL. Safe to expose. */
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || '';

/**
 * Anon/publishable key. Safe to expose — it is RLS-gated. Supabase renamed
 * these keys mid-2025, so accept either spelling.
 */
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  '';

/**
 * Whether the URL is something the Supabase SDK will actually accept.
 *
 * This matters more than it looks: the SDK throws from its constructor on a
 * malformed URL, and that constructor runs in the proxy on *every* request. A
 * mistyped variable therefore takes down the whole deployment — every route
 * returns an HTML error page, including the diagnostics endpoint meant to
 * explain what went wrong. Treating an unusable URL as "not configured" keeps
 * the app up and lets `/api/health` say what is broken.
 */
export function isUsableSupabaseUrl(url: string = SUPABASE_URL): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/** Whether the browser has enough config to talk to Supabase Auth/Realtime. */
export const isSupabaseConfigured = (): boolean =>
  Boolean(isUsableSupabaseUrl() && SUPABASE_ANON_KEY);

/**
 * The service-role key deliberately lives in ./service.ts, not here: this
 * module is imported by client components, and the secret must have no path
 * into a browser bundle at all.
 */

/**
 * Absolute origin of this deployment, used for magic-link redirects. Vercel
 * sets VERCEL_PROJECT_PRODUCTION_URL / VERCEL_URL; locally we fall back to the
 * dev server.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');

  const vercel =
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
    process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/$/, '')}`;

  return 'http://localhost:3000';
}
