/**
 * The complete game-state contract, covering base Catan, Seafarers and
 * Cities & Knights. Expansion-specific fields are optional and are only
 * populated when the matching flag in `GameOptions.expansions` is set.
 *
 * `GameState` is serialised to JSON and stored server-side, so everything here
 * must stay plain-data: no class instances, no Maps, no Sets, no undefined
 * round-trips that matter.
 */

import type { EdgeId, HexCoord, VertexId } from './hex';

// ---------------------------------------------------------------------------
// Resources and commodities
// ---------------------------------------------------------------------------

export const RESOURCES = ['brick', 'lumber', 'wool', 'grain', 'ore'] as const;
export type Resource = (typeof RESOURCES)[number];

/** Cities & Knights commodities, each produced by a city on a matching hex. */
export const COMMODITIES = ['coin', 'paper', 'cloth'] as const;
export type Commodity = (typeof COMMODITIES)[number];

export type Tradeable = Resource | Commodity;

/** Counts of everything a player can hold. Missing keys mean zero. */
export type Hand = Partial<Record<Tradeable, number>>;

/** Which commodity a city on a given terrain produces (C&K). */
export const COMMODITY_FOR_TERRAIN: Partial<Record<Terrain, Commodity>> = {
  mountains: 'coin',
  forest: 'paper',
  pasture: 'cloth',
};

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export type Terrain =
  | 'hills' // brick
  | 'forest' // lumber
  | 'pasture' // wool
  | 'fields' // grain
  | 'mountains' // ore
  | 'desert'
  | 'sea'
  | 'gold' // Seafarers: produces one resource of the holder's choice
  | 'fog'; // Seafarers: face-down until a ship reveals it

export const RESOURCE_FOR_TERRAIN: Partial<Record<Terrain, Resource>> = {
  hills: 'brick',
  forest: 'lumber',
  pasture: 'wool',
  fields: 'grain',
  mountains: 'ore',
};

/** Terrains that yield something when their number is rolled. */
export const PRODUCING_TERRAINS: Terrain[] = [
  'hills',
  'forest',
  'pasture',
  'fields',
  'mountains',
  'gold',
];

export interface Hex {
  coord: HexCoord;
  terrain: Terrain;
  /** Dice number, absent on desert/sea. */
  number?: number;
  /**
   * Seafarers: hexes belong to an island group. Island 0 is the main island;
   * settling a new island for the first time may award bonus victory points.
   */
  island?: number;
  /** Seafarers fog hexes: what is revealed underneath. */
  hidden?: { terrain: Terrain; number?: number };
}

export type PortKind = Resource | 'any';

export interface Port {
  /** The two vertices where a ship or settlement can use this port. */
  vertices: VertexId[];
  kind: PortKind;
  /** 2 for a resource-specific port, 3 for a generic one. */
  ratio: 2 | 3;
  /** The sea hex the port sits on, for rendering. */
  hex: HexCoord;
}

export interface Board {
  hexes: Hex[];
  ports: Port[];
  /** Vertices that exist on this board (touch at least one land hex). */
  landVertices: VertexId[];
  /** Edges buildable by road. */
  roadEdges: EdgeId[];
  /** Edges buildable by ship (Seafarers): touching at least one sea hex. */
  shipEdges: EdgeId[];
  robber: HexCoord;
  /** Seafarers: the pirate blocks sea hexes and shipping. */
  pirate?: HexCoord;
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

export type PlayerId = string;

export interface Settlement {
  vertex: VertexId;
  owner: PlayerId;
  kind: 'settlement' | 'city';
  /** C&K: a city wall raises this player's hand limit on a 7. */
  wall?: boolean;
  /** C&K: a metropolis cannot be destroyed by barbarians. */
  metropolis?: ImprovementTrack;
}

export interface RoadPiece {
  edge: EdgeId;
  owner: PlayerId;
  kind: 'road' | 'ship';
  /** Seafarers: a ship that has been moved this turn, or is locked in place. */
  locked?: boolean;
}

// ---------------------------------------------------------------------------
// Cities & Knights
// ---------------------------------------------------------------------------

/** The three city-improvement tracks. */
export type ImprovementTrack = 'trade' | 'politics' | 'science';

export const TRACK_COMMODITY: Record<ImprovementTrack, Commodity> = {
  trade: 'cloth',
  politics: 'coin',
  science: 'paper',
};

export type KnightRank = 1 | 2 | 3; // basic, strong, mighty

export interface Knight {
  id: string;
  vertex: VertexId;
  owner: PlayerId;
  rank: KnightRank;
  active: boolean;
  /** Knights may not act on the turn they are activated or promoted. */
  usedThisTurn: boolean;
}

export type ProgressDeck = ImprovementTrack;

export interface ProgressCard {
  id: string;
  deck: ProgressDeck;
  kind: ProgressCardKind;
}

export type ProgressCardKind =
  // trade (yellow)
  | 'commercial_harbor'
  | 'master_merchant'
  | 'merchant'
  | 'merchant_fleet'
  | 'resource_monopoly'
  | 'trade_monopoly'
  // politics (blue)
  | 'bishop'
  | 'constitution'
  | 'deserter'
  | 'diplomat'
  | 'intrigue'
  | 'saboteur'
  | 'spy'
  | 'warlord'
  | 'wedding'
  // science (green)
  | 'alchemist'
  | 'crane'
  | 'engineer'
  | 'inventor'
  | 'irrigation'
  | 'medicine'
  | 'mining'
  | 'printer'
  | 'road_building'
  | 'smith';

/** Base-game development cards (not used when Cities & Knights is on). */
export type DevCardKind =
  | 'knight'
  | 'road_building'
  | 'year_of_plenty'
  | 'monopoly'
  | 'victory_point';

export interface DevCard {
  id: string;
  kind: DevCardKind;
  /** Turn number it was bought on; it cannot be played the same turn. */
  boughtOnTurn: number;
  played?: boolean;
}

/** The event die face rolled alongside the two production dice in C&K. */
export type EventDie = 'barbarian' | 'trade' | 'politics' | 'science';

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export interface Player {
  id: PlayerId;
  name: string;
  color: string;
  isBot: boolean;
  botDifficulty?: 'easy' | 'normal' | 'hard';
  /** Present for human seats claimed by a signed-in user. */
  userId?: string;
  connected?: boolean;

  hand: Hand;
  devCards: DevCard[];
  /** Development cards played, used for largest army in the base game. */
  knightsPlayed: number;

  /** Pieces left in supply. */
  supply: {
    roads: number;
    settlements: number;
    cities: number;
    ships: number;
    /** C&K city walls. */
    walls: number;
  };

  victoryPoints: number;
  /** Points from cards/awards that are hidden from opponents until scored. */
  hiddenPoints: number;

  // --- Seafarers ---
  /** Islands this player has already scored a landfall bonus on. */
  islandsSettled?: number[];

  // --- Cities & Knights ---
  improvements?: Record<ImprovementTrack, number>;
  progressCards?: ProgressCard[];
  /** Contribution to repelling the current barbarian attack. */
  defenderPoints?: number;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface GameOptions {
  expansions: {
    seafarers: boolean;
    citiesAndKnights: boolean;
  };
  victoryPointsToWin: number;
  /** Board preset id, or 'random' for generated boards. */
  scenario: string;
  /** Radius for randomly generated boards. 2 is the classic 19-hex island. */
  boardRadius: number;
  /** Number of gold hexes to sprinkle into a random board. */
  goldHexCount: number;
  /** Discard on a 7 when holding more than this. */
  handLimit: number;
  /** Seed for all randomness, so games are reproducible and verifiable. */
  seed: string;
  /** Seconds a player has per turn, or 0 for untimed. */
  turnTimeLimit: number;
  /** Friendly robber: cannot rob a player with 2 or fewer points. */
  friendlyRobber: boolean;
}

// ---------------------------------------------------------------------------
// Turn flow
// ---------------------------------------------------------------------------

export type Phase =
  /** Placing the first settlement + road of the opening snake draft. */
  | 'setup_first'
  /** Placing the second settlement + road (reverse order). */
  | 'setup_second'
  /** Waiting for the current player to roll. */
  | 'roll'
  /** Post-roll: build, trade, play cards. */
  | 'main'
  /** Someone rolled a 7 (or barbarians won) and players owe discards. */
  | 'discard'
  /** The current player must place the robber. */
  | 'move_robber'
  /** The current player must place the pirate (Seafarers). */
  | 'move_pirate'
  /** The current player picks a victim to rob. */
  | 'steal'
  /** Gold hex production: the player chooses which resources to take. */
  | 'choose_gold'
  /** A trade offer is on the table. */
  | 'trade_response'
  /** C&K: barbarians landed and this player must destroy a city or knight. */
  | 'barbarian_loss'
  /** A progress card needs a follow-up choice. */
  | 'progress_action'
  | 'game_over';

/** Something the current player still owes before play can continue. */
export interface PendingAction {
  kind: string;
  playerId: PlayerId;
  /** Free-form payload interpreted by the rules module that queued it. */
  data?: Record<string, unknown>;
}

export interface TradeOffer {
  id: string;
  from: PlayerId;
  /** Empty means the offer is open to everyone. */
  to: PlayerId[];
  give: Hand;
  receive: Hand;
  /** Players who have accepted so far. */
  accepted: PlayerId[];
  rejected: PlayerId[];
}

export interface DiceRoll {
  white: number;
  red: number;
  /** C&K only. */
  event?: EventDie;
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

export interface GameState {
  id: string;
  version: number;
  options: GameOptions;
  board: Board;
  players: Player[];
  /** Index into `players`. */
  currentPlayer: number;
  phase: Phase;
  turn: number;
  lastRoll?: DiceRoll;

  /** Ordered queue of things blocking progress, e.g. discards owed. */
  pending: PendingAction[];
  activeTrade?: TradeOffer;

  settlements: Settlement[];
  roads: RoadPiece[];

  /** Undrawn base-game development cards. */
  devDeck: DevCard[];

  /** Awards. */
  longestRoad?: { owner: PlayerId; length: number };
  largestArmy?: { owner: PlayerId; size: number };

  // --- Cities & Knights ---
  knights?: Knight[];
  /** Undrawn progress cards per deck. */
  progressDecks?: Record<ProgressDeck, ProgressCard[]>;
  /** How far the barbarian ship has advanced, 0..7. */
  barbarianPosition?: number;
  /** How many attacks have happened, used for the defender award. */
  barbarianAttacks?: number;
  /** C&K: which player holds the merchant, and where. */
  merchant?: { owner: PlayerId; hex: HexCoord };
  defenderOfCatan?: Record<PlayerId, number>;
  /** Which metropolises have been claimed. */
  metropolises?: Partial<Record<ImprovementTrack, PlayerId>>;

  winner?: PlayerId;
  /** Human-readable log, newest last. */
  log: LogEntry[];
  /** Number of random draws consumed, so the seeded RNG can be replayed. */
  rngCursor: number;
}

export interface LogEntry {
  turn: number;
  playerId?: PlayerId;
  message: string;
  at: number;
}

// ---------------------------------------------------------------------------
// Build costs
// ---------------------------------------------------------------------------

export const COSTS = {
  road: { brick: 1, lumber: 1 },
  ship: { lumber: 1, wool: 1 },
  settlement: { brick: 1, lumber: 1, wool: 1, grain: 1 },
  city: { grain: 2, ore: 3 },
  devCard: { wool: 1, grain: 1, ore: 1 },
  cityWall: { brick: 2 },
  knight: { wool: 1, ore: 1 },
  activateKnight: { grain: 1 },
  promoteKnight: { wool: 1, ore: 1 },
} as const satisfies Record<string, Hand>;
