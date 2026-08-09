'use client';

/**
 * Play the log back rather than snapping to the result.
 *
 * The server applies your move and then runs every bot turn to completion in
 * one request, so the state that comes back can be several turns further on.
 * Without this the board simply changes and you have no idea what happened —
 * which dice came up, who collected what, how close the barbarians got.
 *
 * The game log is already a complete, ordered account of all of it, so this
 * walks the newly-arrived entries at a readable pace and hands the UI one at a
 * time. It is presentation only: the state is whatever the server said, and a
 * player who does not want to wait can skip to the end.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { LogEntry } from '@/game/types';

/** How long each kind of event stays on screen, in milliseconds. */
const DWELL: Record<string, number> = {
  roll: 1400,
  gain: 1100,
  barbarian: 1200,
  barbarian_attack: 2200,
  build: 900,
  card: 1100,
  trade: 1100,
};
const DEFAULT_DWELL = 800;

/** Never hold up play for longer than this, however much happened. */
const MAX_TOTAL_MS = 20_000;

export interface TurnPlayback {
  /** The entry to show now, or null when there is nothing to play. */
  current: LogEntry | null;
  /** Entries already shown this run, newest last. */
  shown: LogEntry[];
  playing: boolean;
  remaining: number;
  skip: () => void;
}

export function useTurnPlayback(
  log: readonly LogEntry[] | undefined,
  enabled = true,
): TurnPlayback {
  const [queue, setQueue] = useState<LogEntry[]>([]);
  const [shown, setShown] = useState<LogEntry[]>([]);
  const [current, setCurrent] = useState<LogEntry | null>(null);

  // How much of the log has been accounted for. Starts at -1 so the first
  // state we ever see is adopted wholesale rather than played back — nobody
  // wants the entire history replayed when they open a game in progress.
  const seen = useRef(-1);
  const timer = useRef<number | null>(null);
  const budget = useRef(MAX_TOTAL_MS);

  useEffect(() => {
    if (!log) return;
    if (seen.current < 0) {
      seen.current = log.length;
      return;
    }
    if (log.length <= seen.current) {
      // The log shrank, which only happens on a different game entirely.
      if (log.length < seen.current) seen.current = log.length;
      return;
    }
    const fresh = log.slice(seen.current);
    seen.current = log.length;
    if (!enabled) return;
    budget.current = MAX_TOTAL_MS;
    setQueue((q) => [...q, ...fresh]);
  }, [log, enabled]);

  // Advance one entry at a time. Each tick schedules the next, so a long run
  // plays out without ever blocking input.
  useEffect(() => {
    if (timer.current !== null) return;
    if (queue.length === 0) {
      if (current) {
        timer.current = window.setTimeout(() => {
          timer.current = null;
          setCurrent(null);
        }, DEFAULT_DWELL);
      }
      return;
    }

    const [next, ...rest] = queue;
    const dwell = Math.min(
      DWELL[next.kind ?? ''] ?? DEFAULT_DWELL,
      Math.max(120, budget.current / Math.max(1, queue.length)),
    );
    budget.current -= dwell;

    setCurrent(next);
    setShown((s) => [...s.slice(-40), next]);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setQueue(rest);
    }, dwell);
  }, [queue, current]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const skip = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    setShown((s) => [...s, ...queue].slice(-40));
    setQueue([]);
    setCurrent(null);
  }, [queue]);

  return {
    current,
    shown,
    playing: queue.length > 0 || current !== null,
    remaining: queue.length,
    skip,
  };
}
