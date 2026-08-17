/**
 * Every way a player can change the game. Actions are the only input to the
 * reducer, they are validated server-side, and they are what travels over the
 * wire — so they must stay small and fully serialisable.
 */

import type { EdgeId, HexCoord, VertexId } from './hex';
import type {
  Commodity,
  Hand,
  ImprovementTrack,
  PlayerId,
  ProgressCardKind,
  Resource,
} from './types';

interface Base {
  /** Filled in server-side from the session; clients may not set it. */
  playerId: PlayerId;
}

export type GameAction =
  // --- turn flow ---
  | (Base & { type: 'roll' })
  | (Base & { type: 'end_turn' })

  // --- building ---
  | (Base & { type: 'build_road'; edge: EdgeId })
  | (Base & { type: 'build_ship'; edge: EdgeId })
  | (Base & { type: 'move_ship'; from: EdgeId; to: EdgeId })
  | (Base & { type: 'build_settlement'; vertex: VertexId })
  | (Base & { type: 'build_city'; vertex: VertexId })
  | (Base & { type: 'buy_dev_card' })
  | (Base & { type: 'play_dev_card'; cardId: string; choice?: DevCardChoice })

  // --- robber / pirate ---
  | (Base & { type: 'discard'; hand: Hand })
  | (Base & { type: 'move_robber'; hex: HexCoord })
  | (Base & { type: 'move_pirate'; hex: HexCoord })
  | (Base & { type: 'steal'; victim: PlayerId | null })

  // --- gold hexes (Seafarers) ---
  | (Base & { type: 'choose_gold'; resources: Partial<Record<Resource, number>> })

  // --- trade ---
  | (Base & { type: 'offer_trade'; give: Hand; receive: Hand; to?: PlayerId[] })
  | (Base & { type: 'respond_trade'; accept: boolean })
  | (Base & { type: 'confirm_trade'; with: PlayerId })
  | (Base & { type: 'cancel_trade' })
  | (Base & { type: 'bank_trade'; give: Hand; receive: Hand })

  // --- Cities & Knights ---
  | (Base & { type: 'buy_improvement'; track: ImprovementTrack })
  | (Base & { type: 'build_knight'; vertex: VertexId })
  | (Base & { type: 'activate_knight'; knightId: string })
  | (Base & { type: 'promote_knight'; knightId: string })
  | (Base & { type: 'move_knight'; knightId: string; to: VertexId })
  | (Base & { type: 'chase_robber'; knightId: string })
  | (Base & { type: 'build_wall'; vertex: VertexId })
  | (Base & {
      type: 'play_progress_card';
      cardId: string;
      choice?: ProgressCardChoice;
    })
  | (Base & { type: 'discard_progress_card'; cardId: string })
  | (Base & { type: 'choose_metropolis'; track: ImprovementTrack })
  | (Base & { type: 'barbarian_loss'; vertex: VertexId })

  // --- meta ---
  | (Base & { type: 'resign' });

export type DevCardChoice =
  | { kind: 'year_of_plenty'; resources: Resource[] }
  | { kind: 'monopoly'; resource: Resource }
  | { kind: 'road_building'; edges: EdgeId[] };

export type ProgressCardChoice =
  | { kind: 'resource_monopoly'; resource: Resource }
  | { kind: 'trade_monopoly'; commodity: Commodity }
  | { kind: 'target_player'; playerId: PlayerId }
  | { kind: 'pick_resources'; resources: Resource[] }
  | { kind: 'pick_edges'; edges: EdgeId[] }
  | { kind: 'pick_vertex'; vertex: VertexId }
  | { kind: 'pick_hex'; hex: HexCoord }
  | { kind: 'pick_card'; cardId: string }
  | { kind: 'pick_track'; track: ImprovementTrack };

export type ActionType = GameAction['type'];

/** Narrow a `GameAction` to one variant. */
export type ActionOf<T extends ActionType> = Extract<GameAction, { type: T }>;

/**
 * The result of applying an action. The reducer never throws for rule
 * violations and never mutates its input — invalid actions come back as
 * `{ ok: false }` so the server can reject them cleanly.
 */
export type ActionResult =
  | { ok: true; state: import('./types').GameState }
  | { ok: false; error: string };

export const fail = (error: string): ActionResult => ({ ok: false, error });
