/**
 * The seam between the base rules and the expansions.
 *
 * `applyAction` walks an ordered list of rule modules and gives each one a
 * chance to handle the action. A module returns `null` to mean "not mine",
 * which lets Seafarers and Cities & Knights add actions and override base
 * behaviour without anyone editing a shared switch statement.
 *
 * Modules are consulted most-specific-first: citiesKnights, then seafarers,
 * then base. Lifecycle hooks run in the opposite order (base first) so the
 * expansions observe an already-updated state.
 */

import type { ActionResult, GameAction } from './actions';
import type { Rng } from './rng';
import type { GameState, Player, PlayerId } from './types';

export interface Ctx {
  /** Seeded RNG, already positioned at `state.rngCursor`. */
  rng: Rng;
  /** Wall-clock ms, passed in so the reducer stays pure and testable. */
  now: number;
}

/**
 * Rule modules receive a draft they are free to mutate. The reducer deep-clones
 * the incoming state before calling them and discards the draft entirely if the
 * module reports failure, so mutation here can never corrupt the real state.
 */
export interface RulesModule {
  name: string;

  /** Whether this module is switched on for the given game. */
  enabled(state: GameState): boolean;

  /**
   * Handle an action, or return `null` to pass it down the chain.
   * Mutate `draft` freely; return `{ ok: true, state: draft }` on success.
   */
  handle?(
    draft: GameState,
    action: GameAction,
    ctx: Ctx,
  ): ActionResult | null;

  /** Called after the dice are rolled, before production is distributed. */
  onRoll?(draft: GameState, ctx: Ctx): void;

  /** Called when a turn begins, after `currentPlayer` has advanced. */
  onTurnStart?(draft: GameState, ctx: Ctx): void;

  /** Called when a turn ends, before `currentPlayer` advances. */
  onTurnEnd?(draft: GameState, ctx: Ctx): void;

  /**
   * Extra victory points this module grants. Returned separately from
   * `player.victoryPoints` so scoring stays a pure recomputation rather than
   * an accumulator that can drift.
   */
  score?(state: GameState, player: Player): number;

  /**
   * Additional actions that are legal right now, for the UI and the bots.
   * Should be cheap; it is called on every render.
   */
  legalActions?(state: GameState, playerId: PlayerId): GameAction[];
}
