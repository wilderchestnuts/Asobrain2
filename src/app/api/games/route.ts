import { nanoid } from 'nanoid';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import type { GameOptions } from '@/game/types';
import { gameView } from '@/lib/api';
import { getIdentity, persistIdentity, setGuestName } from '@/lib/auth';
import { insertGame, listGamesFor, storageProblem } from '@/lib/db';
import type { GameRecord, SeatRecord } from '@/lib/db';
import { createInitialState, statusFor } from '@/lib/engineBridge';
import type { SeatSpec } from '@/lib/engineBridge';

export const dynamic = 'force-dynamic';

import {
  DEFAULT_OPTIONS as ENGINE_DEFAULTS,
  VICTORY_POINT_RANGE,
  defaultVictoryPoints,
} from '@/game/setup';

const COLORS = ['red', 'blue', 'purple', 'orange', 'green', 'white'];

interface SeatInput {
  /** 'me' claims the seat for the caller, 'human' leaves it open to join. */
  kind?: 'me' | 'human' | 'bot';
  name?: string;
  color?: string;
  difficulty?: 'easy' | 'normal' | 'hard';
}

const clamp = (n: unknown, lo: number, hi: number, fallback: number): number =>
  typeof n === 'number' && Number.isFinite(n)
    ? Math.min(hi, Math.max(lo, Math.round(n)))
    : fallback;

/**
 * Never trust client options wholesale: they end up in the rules.
 *
 * Bounds are enforced here, but *defaults* come from the engine — duplicating
 * them silently drifts, which is how a Cities & Knights game ended up with the
 * base game's ten-point target.
 */
function sanitiseOptions(raw: unknown): GameOptions {
  const o = (raw ?? {}) as Partial<GameOptions> & Record<string, unknown>;
  const exp = (o.expansions ?? {}) as Partial<GameOptions['expansions']>;
  const expansions = {
    seafarers: exp.seafarers === true,
    citiesAndKnights: exp.citiesAndKnights === true,
  };
  const trade = (o.botTrade ?? {}) as Partial<
    NonNullable<GameOptions['botTrade']>
  >;

  return {
    ...ENGINE_DEFAULTS,
    expansions,
    victoryPointsToWin: clamp(
      o.victoryPointsToWin,
      VICTORY_POINT_RANGE.min,
      VICTORY_POINT_RANGE.max,
      defaultVictoryPoints(expansions),
    ),
    scenario: typeof o.scenario === 'string' ? o.scenario.slice(0, 64) : 'random',
    boardRadius: clamp(o.boardRadius, 2, 5, 2),
    goldHexCount: clamp(o.goldHexCount, 0, 12, 0),
    handLimit: clamp(o.handLimit, 3, 20, 7),
    seed: typeof o.seed === 'string' && o.seed ? o.seed.slice(0, 64) : nanoid(12),
    turnTimeLimit: clamp(o.turnTimeLimit, 0, 3600, 0),
    friendlyRobber: o.friendlyRobber === true,
    // Capped low on purpose: bots must not be able to spam trade requests.
    botTrade: {
      maxPerGame: clamp(
        trade.maxPerGame,
        0,
        20,
        ENGINE_DEFAULTS.botTrade?.maxPerGame ?? 6,
      ),
      maxPerTurn: clamp(
        trade.maxPerTurn,
        0,
        3,
        ENGINE_DEFAULTS.botTrade?.maxPerTurn ?? 1,
      ),
    },
  };
}

export async function GET() {
  const identity = await getIdentity();
  const games = await listGamesFor(identity);
  return persistIdentity(NextResponse.json({ games }), identity);
}

export async function POST(req: NextRequest) {
  // Fail before doing any work if the game could not possibly be stored.
  const blocked = storageProblem();
  if (blocked) {
    return NextResponse.json({ error: blocked }, { status: 503 });
  }

  const identity = await getIdentity();

  let body: {
    options?: unknown;
    seats?: SeatInput[];
    displayName?: string;
    isPublic?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const displayName =
    (typeof body.displayName === 'string' && body.displayName.trim()) ||
    identity.displayName;

  const rawSeats: SeatInput[] =
    Array.isArray(body.seats) && body.seats.length >= 2
      ? body.seats.slice(0, 6)
      : [{ kind: 'me' }, { kind: 'human' }, { kind: 'bot' }, { kind: 'bot' }];

  // Exactly one seat belongs to the creator; extra 'me' seats would let one
  // browser hold two hands.
  let claimed = false;
  const seatSpecs: SeatSpec[] = [];
  const seatRecords: SeatRecord[] = [];

  rawSeats.forEach((raw, index) => {
    const isMe = raw.kind === 'me' && !claimed;
    if (isMe) claimed = true;
    const isBot = raw.kind === 'bot';
    const playerId = `p${index}`;
    const name =
      (typeof raw.name === 'string' && raw.name.trim().slice(0, 40)) ||
      (isMe ? displayName : isBot ? `Bot ${index + 1}` : `Player ${index + 1}`);
    const color =
      typeof raw.color === 'string' && raw.color.trim()
        ? raw.color.trim().slice(0, 20)
        : COLORS[index % COLORS.length];
    const botDifficulty = isBot ? (raw.difficulty ?? 'normal') : undefined;

    seatSpecs.push({
      playerId,
      name,
      color,
      isBot,
      botDifficulty,
      userId: isMe && identity.userId ? identity.userId : undefined,
    });
    seatRecords.push({
      seat: index,
      playerId,
      userId: isMe ? identity.userId : null,
      guestId: isMe ? identity.guestId : null,
      name,
      color,
      isBot,
      botDifficulty: botDifficulty ?? null,
    });
  });

  if (!claimed) {
    // A game nobody is sitting in is never what was meant.
    seatSpecs[0] = { ...seatSpecs[0], isBot: false, name: displayName };
    seatRecords[0] = {
      ...seatRecords[0],
      isBot: false,
      botDifficulty: null,
      name: displayName,
      userId: identity.userId,
      guestId: identity.guestId,
    };
  }

  const options = sanitiseOptions(body.options);
  const id = crypto.randomUUID();

  let state;
  try {
    state = createInitialState(id, options, seatSpecs);
  } catch (err) {
    // e.g. a seat count the rules cannot seat.
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  state.version = 0;

  const waiting = seatRecords.some((s) => !s.isBot && !s.userId && !s.guestId);
  const now = new Date().toISOString();

  const record: GameRecord = {
    id,
    createdBy: identity.userId,
    createdByGuest: identity.guestId,
    status: waiting ? 'lobby' : statusFor(state),
    options: { ...options, isPublic: body.isPublic === true },
    state,
    version: 0,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    seats: seatRecords,
  };

  try {
    await insertGame(record);
  } catch (err) {
    // Almost always a misconfigured deployment rather than a bug: the schema
    // has not been applied, or the service-role key is missing. Say so plainly
    // — an unhandled throw here becomes an HTML 500 that the browser reports as
    // an unrelated JSON parse error.
    const message = (err as Error).message;
    const missingTable = /relation .* does not exist|schema cache/i.test(message);
    return NextResponse.json(
      {
        error: missingTable
          ? `The database is reachable but the tables are missing. Run supabase/migrations/0001_init.sql in the Supabase SQL editor. (${message})`
          : `Could not save the game: ${message}`,
        hint: '/api/health reports what is configured.',
      },
      { status: 500 },
    );
  }

  const res = NextResponse.json(gameView(record, identity), { status: 201 });
  persistIdentity(res, identity);
  if (identity.kind === 'guest') setGuestName(res, displayName);
  return res;
}
