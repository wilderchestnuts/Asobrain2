/**
 * Deployment diagnostics.
 *
 * Answers "why won't it start a game?" without needing server logs. It reports
 * whether each piece of configuration is present and well-formed, and actually
 * touches the database so a missing migration shows up as a missing table
 * rather than as a mysterious 500.
 *
 * It deliberately never returns a key — only whether one is set, its length,
 * and its prefix, which is enough to spot a truncated paste or the wrong key in
 * the wrong variable.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { SUPABASE_ANON_KEY, SUPABASE_URL, siteUrl } from '@/lib/supabase/env';
import { getServiceSupabase, serviceRoleKey } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

interface Check {
  ok: boolean;
  detail: string;
}

const describeKey = (key: string): string =>
  key ? `set (${key.length} chars, starts "${key.slice(0, 11)}…")` : 'NOT SET';

export async function GET(req: NextRequest) {
  // Reading proves the tables exist; only writing proves a game can be saved.
  // Opt-in, because it inserts and then removes a row.
  const deep = req.nextUrl.searchParams.get('deep') === '1';
  const checks: Record<string, Check> = {};

  // --- URL ---
  let urlOk = false;
  if (!SUPABASE_URL) {
    checks.supabaseUrl = { ok: false, detail: 'NEXT_PUBLIC_SUPABASE_URL is not set' };
  } else if (!/^https?:\/\//i.test(SUPABASE_URL)) {
    checks.supabaseUrl = {
      ok: false,
      detail: `must start with https:// — got "${SUPABASE_URL.slice(0, 60)}"`,
    };
  } else {
    try {
      const host = new URL(SUPABASE_URL).hostname;
      urlOk = true;
      checks.supabaseUrl = {
        ok: true,
        detail: host.endsWith('.supabase.co')
          ? host
          : `${host} (not a *.supabase.co host — is this the Project URL and not the dashboard URL?)`,
      };
    } catch {
      checks.supabaseUrl = {
        ok: false,
        detail: `malformed URL: "${SUPABASE_URL.slice(0, 60)}"`,
      };
    }
  }

  // --- keys ---
  checks.anonKey = {
    ok: Boolean(SUPABASE_ANON_KEY),
    detail: describeKey(SUPABASE_ANON_KEY),
  };
  const secret = serviceRoleKey();
  checks.serviceRoleKey = {
    ok: Boolean(secret),
    detail: secret
      ? describeKey(secret)
      : 'NOT SET — set SUPABASE_SECRET_KEY (new projects) or SUPABASE_SERVICE_ROLE_KEY (older ones). Without it the server cannot write games.',
  };

  // A publishable key in the secret slot is a common and confusing mix-up.
  // Guard on the key being present, or two empty strings compare equal and
  // "not set" gets reported as "wrong key".
  if (
    secret &&
    (secret.startsWith('sb_publishable_') || secret === SUPABASE_ANON_KEY)
  ) {
    checks.serviceRoleKey = {
      ok: false,
      detail: 'this looks like the PUBLISHABLE key, not the secret one',
    };
  }

  checks.siteUrl = { ok: true, detail: siteUrl() };

  // --- database ---
  const db = getServiceSupabase();
  if (!db) {
    checks.database = {
      ok: false,
      detail:
        'running in local mode (no Supabase). On a serverless host games will vanish between requests.',
    };
  } else if (!urlOk) {
    checks.database = { ok: false, detail: 'skipped: the URL is not usable' };
  } else {
    for (const table of ['games', 'game_players', 'game_actions'] as const) {
      const { error } = await db.from(table).select('*', { head: true, count: 'exact' });
      checks[`table:${table}`] = error
        ? {
            ok: false,
            detail: /does not exist|schema cache/i.test(error.message)
              ? 'MISSING — run supabase/migrations/0001_init.sql in the SQL editor'
              : error.message,
          }
        : { ok: true, detail: 'present' };
    }
    checks.database = { ok: true, detail: 'reachable with the service-role key' };

    if (deep) {
      // Exercise exactly what "Start game" does: insert a game plus a seat,
      // then clean up. Column mismatches, enum problems and row-level security
      // surprises all surface here and nowhere else.
      const probeId = crypto.randomUUID();
      try {
        const { error: gameError } = await db.from('games').insert({
          id: probeId,
          status: 'lobby',
          options: { probe: true },
          state: null,
          version: 0,
        });
        if (gameError) throw new Error(`games insert: ${gameError.message}`);

        const { error: seatError } = await db.from('game_players').insert({
          game_id: probeId,
          seat: 0,
          player_id: 'p0',
          name: 'probe',
          color: 'red',
          is_bot: false,
        });
        if (seatError) throw new Error(`game_players insert: ${seatError.message}`);

        const { error: actionError } = await db.from('game_actions').insert({
          game_id: probeId,
          seat: 0,
          action: { type: 'probe' },
          applied_version: 0,
        });
        if (actionError) throw new Error(`game_actions insert: ${actionError.message}`);

        checks.writeProbe = {
          ok: true,
          detail: 'a game, a seat and an action all saved and were removed again',
        };
      } catch (err) {
        checks.writeProbe = { ok: false, detail: (err as Error).message };
      } finally {
        // Cascades clear the child rows.
        await db.from('games').delete().eq('id', probeId);
      }
    } else {
      checks.writeProbe = {
        ok: true,
        detail: 'not run — add ?deep=1 to actually save and delete a test game',
      };
    }
  }

  const ok = Object.values(checks).every((c) => c.ok);
  return NextResponse.json(
    {
      ok,
      summary: ok
        ? 'Everything needed to play is configured.'
        : 'Something is misconfigured — see the failing checks below.',
      checks,
      note: 'Environment variables are read at build time on Vercel. After changing one, redeploy.',
    },
    { status: ok ? 200 : 503 },
  );
}
