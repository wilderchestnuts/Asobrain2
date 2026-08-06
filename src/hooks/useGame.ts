'use client';

/**
 * The hook the game UI talks to: a live view of one game, plus `send()`.
 *
 * Nothing here computes rules. An action is posted, the server answers with the
 * new redacted view (already including whatever the bots did), and that view is
 * adopted wholesale. A rejected action is surfaced as `actionError` rather than
 * being rolled back, because the client never applied it in the first place.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import type { GameAction } from '@/game/actions';
import type { GameState, Player } from '@/game/types';
import type { GameView } from '@/lib/api';

import { useRealtimeGame } from './useRealtimeGame';

/** Distributes over the union so every variant keeps its own fields. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** `playerId` is filled in server-side from the session; clients may not set it. */
export type ClientAction = DistributiveOmit<GameAction, 'playerId'>;

export interface SendResult {
  ok: boolean;
  error?: string;
}

export interface UseGame {
  view: GameView | null;
  state: GameState | null;
  loading: boolean;
  /** Transport or permission failure. */
  error: string | null;
  /** The last action the rules rejected. */
  actionError: string | null;
  clearActionError: () => void;
  sending: boolean;
  connected: boolean;
  me: Player | null;
  myPlayerId: string | null;
  mySeat: number | null;
  isMyTurn: boolean;
  /** Something this player owes before anyone can continue (e.g. a discard). */
  owed: string | null;
  send: (action: ClientAction) => Promise<SendResult>;
  join: (name?: string) => Promise<SendResult>;
  refresh: () => Promise<unknown>;
}

export function useGame(gameId: string | null): UseGame {
  const { view, loading, error, connected, refresh, applyView } =
    useRealtimeGame(gameId);

  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // The game is turn-based; overlapping posts can only ever be a double-tap.
  const busy = useRef(false);

  const post = useCallback(
    async (path: string, body: unknown): Promise<SendResult> => {
      if (!gameId) return { ok: false, error: 'no game' };
      if (busy.current) return { ok: false, error: 'busy' };

      busy.current = true;
      setSending(true);
      setActionError(null);
      try {
        const res = await fetch(`/api/games/${gameId}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          cache: 'no-store',
          body: JSON.stringify(body),
        });

        if (res.status === 409) {
          // Someone else moved first; the view we based this on is stale.
          await refresh();
          const conflict = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          const message = conflict.error ?? 'conflict';
          setActionError(message);
          return { ok: false, error: message };
        }

        let payload: GameView;
        try {
          payload = await readJson<GameView>(res, 'That move did not go through');
        } catch (err) {
          const message = (err as Error).message;
          setActionError(message);
          return { ok: false, error: message };
        }

        applyView(payload);
        return { ok: true };
      } catch (err) {
        const message = (err as Error).message;
        setActionError(message);
        return { ok: false, error: message };
      } finally {
        busy.current = false;
        setSending(false);
      }
    },
    [gameId, refresh, applyView],
  );

  const send = useCallback(
    (action: ClientAction) => post('/action', { action }),
    [post],
  );

  const join = useCallback(
    (name?: string) => post('/join', name ? { name } : {}),
    [post],
  );

  const state = view?.state ?? null;
  const myPlayerId = view?.you.playerId ?? null;

  const me = useMemo(
    () => state?.players.find((p) => p.id === myPlayerId) ?? null,
    [state, myPlayerId],
  );

  const owed = useMemo(() => {
    if (!state || !myPlayerId) return null;
    const first = state.pending?.[0];
    return first && first.playerId === myPlayerId ? first.kind : null;
  }, [state, myPlayerId]);

  const isMyTurn = useMemo(() => {
    if (!state || !myPlayerId) return false;
    if (state.pending?.length) {
      return state.pending.some((p) => p.playerId === myPlayerId);
    }
    return state.players[state.currentPlayer]?.id === myPlayerId;
  }, [state, myPlayerId]);

  return {
    view,
    state,
    loading,
    error,
    actionError,
    clearActionError: useCallback(() => setActionError(null), []),
    sending,
    connected,
    me,
    myPlayerId,
    mySeat: view?.you.seat ?? null,
    isMyTurn,
    owed,
    send,
    join,
    refresh,
  };
}

// ---------------------------------------------------------------------------
// One-shot helpers for the lobby screens
// ---------------------------------------------------------------------------

export interface CreateGameInput {
  options?: Record<string, unknown>;
  seats?: Array<{
    kind?: 'me' | 'human' | 'bot';
    name?: string;
    color?: string;
    difficulty?: 'easy' | 'normal' | 'hard';
  }>;
  displayName?: string;
  isPublic?: boolean;
}

/**
 * Read a response as JSON without letting a non-JSON body hide the real error.
 *
 * A server error often comes back as an HTML page, and calling `.json()` on it
 * throws a parser error instead of the actual problem — in Safari that surfaces
 * as "The string did not match the expected pattern", which says nothing useful
 * about a failed database write.
 */
export async function readJson<T>(
  res: Response,
  fallback: string,
): Promise<T> {
  const text = await res.text();
  let payload: (T & { error?: string }) | null = null;
  try {
    payload = text ? (JSON.parse(text) as T & { error?: string }) : null;
  } catch {
    // Not JSON — keep the body so the message below can quote it.
  }

  if (!res.ok) {
    const detail =
      payload?.error ??
      (text.trim().slice(0, 200) || `empty response (${res.status})`);
    throw new Error(`${fallback} — server said ${res.status}: ${detail}`);
  }
  if (!payload) {
    throw new Error(
      `${fallback} — the server returned ${res.status} but not JSON: ${
        text.trim().slice(0, 200) || '(empty)'
      }`,
    );
  }
  return payload;
}

export async function createGame(input: CreateGameInput): Promise<GameView> {
  const res = await fetch('/api/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(input),
  });
  return readJson<GameView>(res, 'Could not create the game');
}

export interface GameListItem {
  id: string;
  status: 'lobby' | 'active' | 'finished';
  version: number;
  updatedAt: string;
  seats: Array<{ seat: number; name: string; isBot: boolean; playerId: string }>;
  mySeat: number | null;
  currentPlayerName: string | null;
}

export async function listMyGames(): Promise<GameListItem[]> {
  const res = await fetch('/api/games', {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  if (!res.ok) return [];
  const payload = (await res.json()) as { games: GameListItem[] };
  return payload.games ?? [];
}

export interface Me {
  kind: 'user' | 'guest';
  id: string;
  displayName: string;
  /** Supabase Auth is configured, so sign-in is offerable. */
  authAvailable: boolean;
  /** Games survive a server restart (i.e. Postgres, not the local JSON file). */
  persistent: boolean;
}

export async function fetchMe(): Promise<Me | null> {
  try {
    const res = await fetch('/api/me', {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!res.ok) return null;
    return (await res.json()) as Me;
  } catch {
    return null;
  }
}
