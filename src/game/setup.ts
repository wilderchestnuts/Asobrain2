/**
 * Building a new game.
 *
 * Everything random here — the board, the development deck — is drawn from the
 * same seeded RNG in a fixed order, and the resulting cursor is stored on the
 * state. Two games created from the same options are byte-identical.
 */

import { buildProgressDecks } from './rules/citiesKnights';
import { boardForOptions } from './scenarios';
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
  // Deliberately stingy: a bot may ask a human to trade six times per game and
  // never twice in one turn. Trade spam was the top complaint about the game
  // this replaces; see DECISIONS.md.
  botTrade: { maxPerGame: 6, maxPerTurn: 1 },
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

  const expansions = {
    ...DEFAULT_OPTIONS.expansions,
    ...opts.options?.expansions,
  };
  const options: GameOptions = {
    ...DEFAULT_OPTIONS,
    // The target scales with the rule set unless the caller names one.
    victoryPointsToWin:
      opts.options?.victoryPointsToWin ?? defaultVictoryPoints(expansions),
    ...opts.options,
    expansions,
  };

  const rng = new Rng(options.seed, 0);
  // Through the registry, not `generateBoard` directly: naming a scenario has
  // to actually produce that scenario's map. Calling the generator here meant
  // every game got the plain island no matter which map was chosen, and the
  // presets were only ever exercised by their own tests.
  const board = boardForOptions(options, rng);

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
    // Shuffled up front rather than on first use, so the decks are part of the
    // initial state and `redactFor` has something concrete to strip.
    state.progressDecks = buildProgressDecks(rng);
    state.rngCursor = rng.cursor;
  }

  return state;
}

/**
 * The customary target for a given rule set. Longer games need a higher bar:
 * Cities & Knights hands out points faster, and Seafarers adds island bonuses
 * on top. Callers may override it — the owners asked to be able to.
 */
export function defaultVictoryPoints(
  expansions: GameOptions['expansions'],
): number {
  if (expansions.citiesAndKnights && expansions.seafarers) return 15;
  if (expansions.citiesAndKnights) return 13;
  if (expansions.seafarers) return 12;
  return 10;
}

/** Sensible bounds for the setup screen's victory-point picker. */
export const VICTORY_POINT_RANGE = { min: 5, max: 25 };
