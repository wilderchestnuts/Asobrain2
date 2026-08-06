/**
 * Who is calling?
 *
 * Two kinds of identity exist, and every API route treats them the same way
 * once resolved:
 *
 *   - `user`  — signed in through Supabase Auth (email magic link).
 *   - `guest` — no account, identified by a long-lived browser cookie. This is
 *     what makes the app usable on a laptop with no Supabase project wired up
 *     at all, which is how the owner runs it first.
 *
 * Seat ownership is always checked against `identity.key`, never against
 * anything the client sends in the request body.
 */

import { nanoid } from 'nanoid';
import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';

import { createServerSupabase } from './supabase/server';

export const GUEST_COOKIE = 'asobrain_guest';
export const GUEST_NAME_COOKIE = 'asobrain_name';

const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export interface Identity {
  kind: 'user' | 'guest';
  /** Stable owner key for seat checks: the user uuid, or the guest id. */
  key: string;
  userId: string | null;
  guestId: string | null;
  displayName: string;
  /** A guest id was minted for this request and still needs a Set-Cookie. */
  fresh: boolean;
}

export const newGuestId = (): string => `guest_${nanoid(16)}`;

/**
 * Resolve the caller. Never throws and never returns null: an unknown visitor
 * becomes a fresh guest, and the route attaches the cookie to its response via
 * `persistIdentity`.
 */
export async function getIdentity(): Promise<Identity> {
  const supabase = await createServerSupabase();

  if (supabase) {
    // getUser() revalidates the JWT with Supabase; getSession() would trust a
    // cookie the client could have forged.
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (user) {
      const meta = user.user_metadata as Record<string, unknown> | null;
      const metaName =
        typeof meta?.display_name === 'string' ? meta.display_name : '';
      return {
        kind: 'user',
        key: user.id,
        userId: user.id,
        guestId: null,
        displayName:
          metaName || user.email?.split('@')[0] || 'Player',
        fresh: false,
      };
    }
  }

  const store = await cookies();
  const existing = store.get(GUEST_COOKIE)?.value;
  const name = store.get(GUEST_NAME_COOKIE)?.value;
  const guestId = existing || newGuestId();

  return {
    kind: 'guest',
    key: guestId,
    userId: null,
    guestId,
    displayName: name?.trim() || 'Guest',
    fresh: !existing,
  };
}

/** Attach the guest cookie when one was just minted. */
export function persistIdentity<T>(
  res: NextResponse<T>,
  identity: Identity,
): NextResponse<T> {
  if (identity.kind === 'guest' && identity.guestId && identity.fresh) {
    res.cookies.set(GUEST_COOKIE, identity.guestId, {
      httpOnly: false, // the client reads it too, to key local-mode storage
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: GUEST_COOKIE_MAX_AGE,
    });
  }
  return res;
}

/** Set the display name a guest chose, so their seat is labelled sensibly. */
export function setGuestName<T>(
  res: NextResponse<T>,
  name: string,
): NextResponse<T> {
  res.cookies.set(GUEST_NAME_COOKIE, name.slice(0, 40), {
    httpOnly: false,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: GUEST_COOKIE_MAX_AGE,
  });
  return res;
}
