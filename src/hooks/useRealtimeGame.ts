'use client';

/**
 * Keeps one game view fresh.
 *
 * Three independent triggers, because on iOS none of them is reliable alone:
 *
 *   1. Supabase Realtime pushes a version bump (the fast path).
 *   2. A poll every few seconds, because Safari silently kills websockets when
 *      a tab is backgrounded and never tells the page.
 *   3. `visibilitychange`, because picking the iPad back up must show the
 *      current board immediately rather than after the next poll tick.
 *
 * All three converge on the same thing: compare versions cheaply, and refetch
 * the redacted state only when it actually moved.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { GameView } from '@/lib/api';
import { subscribeToGame } from '@/lib/realtime';

/** Slow safety net while the socket is healthy, fast poll once it is not. */
const POLL_CONNECTED_MS = 15_000;
const POLL_FALLBACK_MS = 4_000;

export interface RealtimeGame {
  view: GameView | null;
  loading: boolean;
  error: string | null;
  /** Whether the Realtime socket is currently subscribed. */
  connected: boolean;
  refresh: () => Promise<GameView | null>;
  /** Adopt a view returned by a mutation, skipping a refetch. */
  applyView: (view: GameView) => void;
}

export function useRealtimeGame(gameId: string | null): RealtimeGame {
  const [view, setView] = useState<GameView | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(gameId));
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const versionRef = useRef<number>(-1);
  const inFlight = useRef<Promise<GameView | null> | null>(null);
  // Bumped on every game change so a late response cannot overwrite a newer one.
  const generation = useRef(0);

  const applyView = useCallback((next: GameView) => {
    if (next.version < versionRef.current) return;
    versionRef.current = next.version;
    setView(next);
    setError(null);
    setLoading(false);
  }, []);

  const refresh = useCallback(async (): Promise<GameView | null> => {
    if (!gameId) return null;
    if (inFlight.current) return inFlight.current;

    const mine = generation.current;
    const run = (async () => {
      try {
        const res = await fetch(`/api/games/${gameId}`, {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          if (mine === generation.current) {
            setError(body.error ?? `request failed (${res.status})`);
            setLoading(false);
          }
          return null;
        }
        const next = (await res.json()) as GameView;
        if (mine === generation.current) applyView(next);
        return next;
      } catch (err) {
        if (mine === generation.current) {
          setError((err as Error).message);
          setLoading(false);
        }
        return null;
      } finally {
        inFlight.current = null;
      }
    })();

    inFlight.current = run;
    return run;
  }, [gameId, applyView]);

  /** Poll the tiny version endpoint; only pull the board if it moved. */
  const checkVersion = useCallback(async () => {
    if (!gameId) return;
    try {
      const res = await fetch(`/api/games/${gameId}/version`, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!res.ok) return;
      const meta = (await res.json()) as { version: number };
      if (meta.version !== versionRef.current) await refresh();
    } catch {
      // Offline or asleep. The next tick, or the resume handler, will retry.
    }
  }, [gameId, refresh]);

  useEffect(() => {
    if (!gameId) {
      setView(null);
      setLoading(false);
      return;
    }

    generation.current += 1;
    versionRef.current = -1;
    setLoading(true);
    void refresh();

    const unsubscribe = subscribeToGame(gameId, {
      onChange: (row) => {
        if (row.version !== versionRef.current) void refresh();
      },
      onConnectionChange: setConnected,
    });

    return () => {
      unsubscribe();
      setConnected(false);
    };
  }, [gameId, refresh]);

  useEffect(() => {
    if (!gameId) return;
    const period = connected ? POLL_CONNECTED_MS : POLL_FALLBACK_MS;
    const timer = window.setInterval(() => void checkVersion(), period);
    return () => window.clearInterval(timer);
  }, [gameId, connected, checkVersion]);

  useEffect(() => {
    if (!gameId) return;

    // A backgrounded tab may have missed every push and every poll, so treat a
    // resume as "assume stale" rather than checking the version first.
    const onResume = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const onOnline = () => void refresh();

    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('focus', onResume);
    window.addEventListener('online', onOnline);
    window.addEventListener('pageshow', onResume);

    return () => {
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('focus', onResume);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pageshow', onResume);
    };
  }, [gameId, refresh]);

  return { view, loading, error, connected, refresh, applyView };
}
