/**
 * Game storage, with two interchangeable backends.
 *
 * Postgres (via the service-role client) is the real one. When Supabase is not
 * configured the same interface is served from a JSON file next to the repo,
 * which keeps the app fully playable on one device before anyone has signed up
 * for anything. Routes never branch on which backend is live.
 *
 * The only concurrency control anywhere is the optimistic version check in
 * `saveState`: two devices can submit actions at the same moment, and exactly
 * one of them wins. That is enough for a couple playing against bots, and it
 * cannot silently interleave two writes the way read-modify-write would.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { GameState } from '@/game/types';

import type { Identity } from './auth';
import { getServiceSupabase } from './supabase/service';

export type GameStatus = 'lobby' | 'active' | 'finished';

export interface SeatRecord {
  seat: number;
  playerId: string;
  userId: string | null;
  guestId: string | null;
  name: string;
  color: string;
  isBot: boolean;
  botDifficulty: string | null;
}

export interface GameRecord {
  id: string;
  createdBy: string | null;
  createdByGuest: string | null;
  status: GameStatus;
  options: Record<string, unknown>;
  state: GameState | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  seats: SeatRecord[];
}

export interface GameSummary {
  id: string;
  status: GameStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  seats: Array<Pick<SeatRecord, 'seat' | 'name' | 'isBot' | 'playerId'>>;
  /** The caller's seat, or null if they are only a spectator. */
  mySeat: number | null;
  /** Whose turn it is, for the lobby list. */
  currentPlayerName: string | null;
}

export interface ActionLogEntry {
  seat: number | null;
  action: unknown;
  appliedVersion: number;
}

export type SaveResult =
  | { ok: true; version: number }
  | { ok: false; reason: 'conflict' | 'missing' };

export const isRemoteDb = (): boolean => getServiceSupabase() !== null;

// ---------------------------------------------------------------------------
// Local JSON backend
// ---------------------------------------------------------------------------

interface LocalFile {
  games: Record<string, GameRecord>;
  actions: Array<{ gameId: string } & ActionLogEntry & { at: string }>;
}

const LOCAL_PATH = path.join(process.cwd(), '.asobrain', 'local-games.json');

/**
 * Why storage cannot work, or `null` if it can.
 *
 * Local mode is a real feature on a dev machine, but on a serverless host it is
 * a trap: each request may run in a fresh process with a read-only disk, so a
 * game is created, the browser is redirected to it, and it is already gone.
 * Better to refuse with an explanation than to hand back a game that evaporates.
 */
export function storageProblem(): string | null {
  if (getServiceSupabase()) return null;
  const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  if (!serverless) return null;
  return (
    'This deployment has no database, so a game would not survive being created. ' +
    'Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SECRET_KEY ' +
    'in the Vercel project settings, then redeploy. Open /api/health to see which are missing.'
  );
}

let localCache: LocalFile | null = null;
/** Serialises writes so two concurrent requests cannot clobber the file. */
let localQueue: Promise<unknown> = Promise.resolve();

async function readLocal(): Promise<LocalFile> {
  if (localCache) return localCache;
  try {
    const raw = await fs.readFile(LOCAL_PATH, 'utf8');
    localCache = JSON.parse(raw) as LocalFile;
  } catch {
    localCache = { games: {}, actions: [] };
  }
  return localCache;
}

async function writeLocal(data: LocalFile): Promise<void> {
  localCache = data;
  try {
    await fs.mkdir(path.dirname(LOCAL_PATH), { recursive: true });
    await fs.writeFile(LOCAL_PATH, JSON.stringify(data), 'utf8');
  } catch {
    // Read-only filesystem (e.g. a serverless host). The in-memory copy still
    // serves the current process, which is all local mode promises.
  }
}

function withLocalLock<T>(fn: (data: LocalFile) => Promise<T> | T): Promise<T> {
  const run = localQueue.then(async () => {
    const data = await readLocal();
    const result = await fn(data);
    await writeLocal(data);
    return result;
  });
  localQueue = run.catch(() => undefined);
  return run;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

interface GameRow {
  id: string;
  created_by: string | null;
  created_by_guest: string | null;
  status: GameStatus;
  options: Record<string, unknown> | null;
  state: GameState | null;
  version: number;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

interface SeatRow {
  game_id: string;
  seat: number;
  player_id: string;
  user_id: string | null;
  guest_id: string | null;
  name: string;
  color: string;
  is_bot: boolean;
  bot_difficulty: string | null;
}

const toSeat = (r: SeatRow): SeatRecord => ({
  seat: r.seat,
  playerId: r.player_id,
  userId: r.user_id,
  guestId: r.guest_id,
  name: r.name,
  color: r.color,
  isBot: r.is_bot,
  botDifficulty: r.bot_difficulty,
});

const toGame = (g: GameRow, seats: SeatRow[]): GameRecord => ({
  id: g.id,
  createdBy: g.created_by,
  createdByGuest: g.created_by_guest,
  status: g.status,
  options: g.options ?? {},
  state: g.state,
  version: g.version,
  createdAt: g.created_at,
  updatedAt: g.updated_at,
  finishedAt: g.finished_at,
  seats: seats.map(toSeat).sort((a, b) => a.seat - b.seat),
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Full detail from a PostgREST error.
 *
 * `message` alone routinely omits the useful part — the machine-readable code,
 * the constraint that failed, or the hint PostgREST already worked out. When a
 * write fails on someone else's deployment, this is the difference between a
 * diagnosis and a guessing game.
 */
export function describeDbError(
  error: { message: string; code?: string; details?: string; hint?: string },
): string {
  return [
    error.message,
    error.code && `code=${error.code}`,
    error.details && `details=${error.details}`,
    error.hint && `hint=${error.hint}`,
  ]
    .filter(Boolean)
    .join(' | ');
}

export async function insertGame(record: GameRecord): Promise<GameRecord> {
  const db = getServiceSupabase();
  if (!db) {
    return withLocalLock((data) => {
      data.games[record.id] = record;
      return record;
    });
  }

  const { error: gameError } = await db.from('games').insert({
    id: record.id,
    created_by: record.createdBy,
    created_by_guest: record.createdByGuest,
    status: record.status,
    options: record.options,
    state: record.state,
    version: record.version,
  });
  if (gameError) throw new Error(`insert game: ${describeDbError(gameError)}`);

  const { error: seatError } = await db.from('game_players').insert(
    record.seats.map((s) => ({
      game_id: record.id,
      seat: s.seat,
      player_id: s.playerId,
      user_id: s.userId,
      guest_id: s.guestId,
      name: s.name,
      color: s.color,
      is_bot: s.isBot,
      bot_difficulty: s.botDifficulty,
    })),
  );
  if (seatError) throw new Error(`insert seats: ${describeDbError(seatError)}`);

  return record;
}

export async function loadGame(id: string): Promise<GameRecord | null> {
  const db = getServiceSupabase();
  if (!db) {
    const data = await readLocal();
    return data.games[id] ?? null;
  }

  const { data: game, error } = await db
    .from('games')
    .select('*')
    .eq('id', id)
    .maybeSingle<GameRow>();
  if (error) throw new Error(`load game: ${error.message}`);
  if (!game) return null;

  const { data: seats, error: seatError } = await db
    .from('game_players')
    .select('*')
    .eq('game_id', id)
    .order('seat');
  if (seatError) throw new Error(`load seats: ${seatError.message}`);

  return toGame(game, (seats ?? []) as SeatRow[]);
}

/**
 * Version and status only. The polling fallback hits this every few seconds on
 * every device, and shipping a whole board each time over cellular is exactly
 * the kind of waste that makes an iPad tab get killed.
 */
export async function loadGameMeta(
  id: string,
): Promise<{ version: number; status: GameStatus; updatedAt: string } | null> {
  const db = getServiceSupabase();
  if (!db) {
    const data = await readLocal();
    const game = data.games[id];
    return game
      ? { version: game.version, status: game.status, updatedAt: game.updatedAt }
      : null;
  }

  const { data, error } = await db
    .from('games')
    .select('version, status, updated_at')
    .eq('id', id)
    .maybeSingle<Pick<GameRow, 'version' | 'status' | 'updated_at'>>();
  if (error) throw new Error(`load game meta: ${error.message}`);
  if (!data) return null;
  return { version: data.version, status: data.status, updatedAt: data.updated_at };
}

export async function listGamesFor(
  identity: Identity,
): Promise<GameSummary[]> {
  const db = getServiceSupabase();

  const summarise = (g: GameRecord): GameSummary => {
    const mine = g.seats.find((s) =>
      identity.userId ? s.userId === identity.userId : s.guestId === identity.key,
    );
    const current =
      g.state && g.state.players[g.state.currentPlayer]
        ? g.state.players[g.state.currentPlayer].name
        : null;
    return {
      id: g.id,
      status: g.status,
      version: g.version,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
      seats: g.seats.map((s) => ({
        seat: s.seat,
        name: s.name,
        isBot: s.isBot,
        playerId: s.playerId,
      })),
      mySeat: mine ? mine.seat : null,
      currentPlayerName: current,
    };
  };

  if (!db) {
    const data = await readLocal();
    return Object.values(data.games)
      .filter((g) =>
        g.seats.some((s) =>
          identity.userId
            ? s.userId === identity.userId
            : s.guestId === identity.key,
        ),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(summarise);
  }

  const column = identity.userId ? 'user_id' : 'guest_id';
  const { data: seatRows, error } = await db
    .from('game_players')
    .select('game_id')
    .eq(column, identity.key);
  if (error) throw new Error(`list seats: ${error.message}`);

  const ids = [...new Set((seatRows ?? []).map((r) => r.game_id as string))];
  if (ids.length === 0) return [];

  const games = await Promise.all(ids.map((id) => loadGame(id)));
  return games
    .filter((g): g is GameRecord => g !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(summarise);
}

/**
 * Persist a new state, but only if nobody else moved first.
 *
 * The `version = expected` predicate is the whole concurrency story: if the row
 * has already advanced, no row matches, and the caller gets a 409 and refetches
 * rather than overwriting a move it never saw.
 */
export async function saveState(args: {
  gameId: string;
  expectedVersion: number;
  state: GameState;
  status: GameStatus;
}): Promise<SaveResult> {
  const { gameId, expectedVersion, status } = args;
  const nextVersion = expectedVersion + 1;
  // The state carries its own version so a client can tell, from the payload
  // alone, whether it is looking at a stale snapshot.
  const state: GameState = { ...args.state, version: nextVersion };
  const db = getServiceSupabase();

  if (!db) {
    return withLocalLock((data) => {
      const game = data.games[gameId];
      if (!game) return { ok: false, reason: 'missing' } as SaveResult;
      if (game.version !== expectedVersion) {
        return { ok: false, reason: 'conflict' } as SaveResult;
      }
      game.state = state;
      game.version = nextVersion;
      game.status = status;
      game.updatedAt = new Date().toISOString();
      if (status === 'finished' && !game.finishedAt) {
        game.finishedAt = game.updatedAt;
      }
      return { ok: true, version: nextVersion } as SaveResult;
    });
  }

  const patch: Record<string, unknown> = {
    state,
    version: nextVersion,
    status,
  };
  if (status === 'finished') patch.finished_at = new Date().toISOString();

  const { data, error } = await db
    .from('games')
    .update(patch)
    .eq('id', gameId)
    .eq('version', expectedVersion)
    .select('id');
  if (error) throw new Error(`save state: ${error.message}`);
  if (!data || data.length === 0) return { ok: false, reason: 'conflict' };

  return { ok: true, version: nextVersion };
}

export async function appendActions(
  gameId: string,
  entries: ActionLogEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  const db = getServiceSupabase();

  if (!db) {
    await withLocalLock((data) => {
      const at = new Date().toISOString();
      for (const e of entries) data.actions.push({ gameId, at, ...e });
    });
    return;
  }

  // The log is diagnostic, not load-bearing: a failure here must not undo a
  // move that already committed.
  const { error } = await db.from('game_actions').insert(
    entries.map((e) => ({
      game_id: gameId,
      seat: e.seat,
      action: e.action,
      applied_version: e.appliedVersion,
    })),
  );
  if (error) console.error('append action log failed:', error.message);
}

/** Attach a caller to an empty or bot seat. */
/**
 * Remove a game outright.
 *
 * Abandoned games pile up fast while testing, and a list you cannot prune stops
 * being useful. Child rows go with it via the foreign keys' cascade.
 */
export async function deleteGame(id: string): Promise<void> {
  const db = getServiceSupabase();
  if (!db) {
    await withLocalLock((data) => {
      delete data.games[id];
      data.actions = data.actions.filter((a) => a.gameId !== id);
    });
    return;
  }
  const { error } = await db.from('games').delete().eq('id', id);
  if (error) throw new Error(`delete game: ${describeDbError(error)}`);
}

export async function claimSeat(args: {
  gameId: string;
  seat: number;
  identity: Identity;
  name: string;
}): Promise<void> {
  const { gameId, seat, identity, name } = args;
  const db = getServiceSupabase();

  if (!db) {
    await withLocalLock((data) => {
      const game = data.games[gameId];
      const row = game?.seats.find((s) => s.seat === seat);
      if (!row) return;
      row.userId = identity.userId;
      row.guestId = identity.guestId;
      row.name = name;
      row.isBot = false;
      row.botDifficulty = null;
      if (game.state) {
        const player = game.state.players.find((p) => p.id === row.playerId);
        if (player) {
          player.name = name;
          player.isBot = false;
          delete player.botDifficulty;
          if (identity.userId) player.userId = identity.userId;
        }
      }
    });
    return;
  }

  const { error } = await db
    .from('game_players')
    .update({
      user_id: identity.userId,
      guest_id: identity.guestId,
      name,
      is_bot: false,
      bot_difficulty: null,
    })
    .eq('game_id', gameId)
    .eq('seat', seat);
  if (error) throw new Error(`claim seat: ${error.message}`);
}
