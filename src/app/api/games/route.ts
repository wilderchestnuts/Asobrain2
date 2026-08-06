import { nanoid } from 'nanoid';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import type { GameOptions } from '@/game/types';
import { gameView } from '@/lib/api';
import { getIdentity, persistIdentity, setGuestName } from '@/lib/auth';
import { insertGame, listGamesFor } from '@/lib/db';
import type { GameRecord, SeatRecord } from '@/lib/db';
import { createInitialState, statusFor } from '@/lib/engineBridge';
import type { SeatSpec } from '@/lib/engineBridge';

export const dynamic = 'force-dynamic';

const COLORS = ['red', 'blue', 'white', 'orange', 'green', 'brown'];

const DEFAULT_OPTIONS: GameOptions = {
  expansions: { seafarers: false, citiesAndKnights: false },
  victoryPointsToWin: 10,
  scenario: 'random',
  boardRadius: 2,
  goldHexCount: 0,
  handLimit: 7,
  seed: '',
  turnTimeLimit: 0,
  friendlyRobber: false,
};

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

/** Never trust client options wholesale: they end up in the rules. */
function sanitiseOptions(raw: unknown): GameOptions {
  const o = (raw ?? {}) as Partial<GameOptions> & Record<string, unknown>;
  const exp = (o.expansions ?? {}) as Partial<GameOptions['expansions']>;
  return {
    expansions: {
      seafarers: exp.seafarers === true,
      citiesAndKnights: exp.citiesAndKnights === true,
    },
    victoryPointsToWin: clamp(o.victoryPointsToWin, 3, 30, 10),
    scenario: typeof o.scenario === 'string' ? o.scenario.slice(0, 64) : 'random',
    boardRadius: clamp(o.boardRadius, 2, 5, 2),
    goldHexCount: clamp(o.goldHexCount, 0, 12, 0),
    handLimit: clamp(o.handLimit, 3, 20, 7),
    seed: typeof o.seed === 'string' && o.seed ? o.seed.slice(0, 64) : nanoid(12),
    turnTimeLimit: clamp(o.turnTimeLimit, 0, 3600, 0),
    friendlyRobber: o.friendlyRobber === true,
  };
}

export async function GET() {
  const identity = await getIdentity();
  const games = await listGamesFor(identity);
  return persistIdentity(NextResponse.json({ games }), identity);
}

export async function POST(req: NextRequest) {
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

  await insertGame(record);

  const res = NextResponse.json(gameView(record, identity), { status: 201 });
  persistIdentity(res, identity);
  if (identity.kind === 'guest') setGuestName(res, displayName);
  return res;
}
