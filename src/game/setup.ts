/**
 * Building a new game.
 *
 * Everything random here — the board, the development deck — is drawn from the
 * same seeded RNG in a fixed order, and the resulting cursor is stored on the
 * state. Two games created from the same options are byte-identical.
 */

import { generateBoard } from './board';
import { Rng } from './rng';
import type {
  DevCard,
  DevCardKind,
  GameOptions,
  GameState,
  Player,
  PlayerId,
} from './types';

export interface SeatSpec {
  id?: PlayerId;
  name: string;
  color: string;
  isBot?: boolean;
  botDifficulty?: 'easy' | 'normal' | 'hard';
  userId?: string;
}

export interface CreateGameOptions {
  players: SeatSpec[];
  options?: Partial<GameOptions>;
  /** Game id; supplied by the caller so it can match the database row. */
  id?: string;
  now?: number;
}

export const DEFAULT_OPTIONS: GameOptions = {
  expansions: { seafarers: false, citiesAndKnights: false },
  victoryPointsToWin: 10,
  scenario: 'classic',
  boardRadius: 2,
  goldHexCount: 0,
  handLimit: 7,
  seed: 'catan',
  turnTimeLimit: 0,
  friendlyRobber: false,
};

/** Pieces in a player's colour, straight off the box. */
export const STARTING_SUPPLY = {
  roads: 15,
  settlements: 5,
  cities: 4,
  ships: 15,
  walls: 3,
};

/** The base-game deck: 25 cards, of which more than half are knights. */
export const DEV_DECK_COMPOSITION: Record<DevCardKind, number> = {
  knight: 14,
  victory_point: 5,
  road_building: 2,
  year_of_plenty: 2,
  monopoly: 2,
};

export function buildDevDeck(rng: Rng): DevCard[] {
  const cards: DevCard[] = [];
  for (const [kind, n] of Object.entries(DEV_DECK_COMPOSITION)) {
    for (let i = 0; i < n; i++) {
      cards.push({
        id: `dev-${kind}-${i}`,
        kind: kind as DevCardKind,
        boughtOnTurn: -1,
      });
    }
  }
  return rng.shuffle(cards);
}

export function createGame(opts: CreateGameOptions): GameState {
  if (opts.players.length < 2) throw new Error('a game needs at least 2 players');
  if (opts.players.length > 6) throw new Error('a game seats at most 6 players');

  const options: GameOptions = {
    ...DEFAULT_OPTIONS,
    ...opts.options,
    expansions: {
      ...DEFAULT_OPTIONS.expansions,
      ...opts.options?.expansions,
    },
  };

  const rng = new Rng(options.seed, 0);
  const board = generateBoard(options, rng);

  const players: Player[] = opts.players.map((seat, i) => {
    const player: Player = {
      id: seat.id ?? `p${i}`,
      name: seat.name,
      color: seat.color,
      isBot: seat.isBot ?? false,
      hand: {},
      devCards: [],
      knightsPlayed: 0,
      supply: { ...STARTING_SUPPLY },
      victoryPoints: 0,
      hiddenPoints: 0,
    };
    if (seat.botDifficulty) player.botDifficulty = seat.botDifficulty;
    if (seat.userId) player.userId = seat.userId;
    if (options.expansions.seafarers) player.islandsSettled = [];
    if (options.expansions.citiesAndKnights) {
      player.improvements = { trade: 0, politics: 0, science: 0 };
      player.progressCards = [];
      player.defenderPoints = 0;
    }
    return player;
  });

  // Cities & Knights replaces development cards with the progress decks, which
  // that module builds for itself in `onTurnStart`/its own setup hook.
  const devDeck = options.expansions.citiesAndKnights ? [] : buildDevDeck(rng);

  const state: GameState = {
    id: opts.id ?? `game-${options.seed}`,
    version: 0,
    options,
    board,
    players,
    currentPlayer: 0,
    phase: 'setup_first',
    turn: 0,
    pending: [],
    settlements: [],
    roads: [],
    devDeck,
    log: [
      {
        turn: 0,
        message: `game created with seed "${options.seed}"`,
        at: opts.now ?? 0,
      },
    ],
    rngCursor: rng.cursor,
  };

  if (options.expansions.citiesAndKnights) {
    state.knights = [];
    state.barbarianPosition = 0;
    state.barbarianAttacks = 0;
    state.metropolises = {};
    state.defenderOfCatan = {};
  }

  return state;
}
