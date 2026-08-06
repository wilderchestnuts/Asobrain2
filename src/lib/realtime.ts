'use client';

/**
 * Realtime subscription to a single game row.
 *
 * The payload deliberately carries no game data — the publication only ships
 * `id, version, status, updated_at`, because the full `state` column contains
 * every player's hand. A push means "something changed"; the client then
 * refetches its own redacted view over HTTP.
 *
 * Returns a no-op unsubscribe when Supabase is not configured, so local mode
 * needs no branching at the call site.
 */

import type { RealtimeChannel } from '@supabase/supabase-js';

import { getBrowserSupabase } from './supabase/client';

export interface GameRowPush {
  id: string;
  version: number;
  status: string;
}

export interface SubscribeOptions {
  onChange: (row: GameRowPush) => void;
  /** Fires with false whenever the socket drops, so polling can take over. */
  onConnectionChange?: (connected: boolean) => void;
}

export function subscribeToGame(
  gameId: string,
  { onChange, onConnectionChange }: SubscribeOptions,
): () => void {
  const supabase = getBrowserSupabase();
  if (!supabase) {
    onConnectionChange?.(false);
    return () => {};
  }

  const channel: RealtimeChannel = supabase
    .channel(`game:${gameId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'games',
        filter: `id=eq.${gameId}`,
      },
      (payload) => {
        const row = payload.new as Partial<GameRowPush>;
        if (typeof row.version === 'number') {
          onChange({
            id: gameId,
            version: row.version,
            status: String(row.status ?? ''),
          });
        }
      },
    )
    .subscribe((status) => {
      onConnectionChange?.(status === 'SUBSCRIBED');
    });

  return () => {
    onConnectionChange?.(false);
    void supabase.removeChannel(channel);
  };
}
