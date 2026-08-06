/**
 * `applyAction` — the single entry point into the engine.
 *
 * It clones the incoming state, positions the seeded RNG, walks the rules chain
 * until a module claims the action, and then re-derives everything that is a
 * function of the board: the two awards, every player's score, and whether
 * anyone has just won. Nothing here knows a rule; it knows the *protocol*.
 *
 * Invariants it upholds on behalf of every module:
 *   - the input state is never mutated,
 *   - a rule violation is a returned `{ ok: false }`, never a throw,
 *   - `rngCursor` and `version` advance exactly once per successful action.
 */

import type { ActionResult, GameAction } from './actions';
import { fail } from './actions';
import type { Ctx, RulesModule } from './engine';
import { isSetupPhase, legalActions } from './legal';
import { rngFor } from './rng';
import { applyScores, updateAwards } from './scoring';
import type { GameState, PlayerId } from './types';
import { RULES_MODULES } from './rules';

// ---------------------------------------------------------------------------
// Contract extensions
// ---------------------------------------------------------------------------
/**
 * Fields the engine needs that `types.ts` does not declare yet. They are all
 * plain JSON, so `GameState` stays storable and sendable; they live here as
 * declaration merges rather than edits so `types.ts` remains the single hand-
 * written contract. Fold them into `types.ts` when it is next revised.
 */
declare module './types' {
  interface GameState {
    /** One development card per turn; cleared when the turn advances. */
    devCardPlayedThisTurn?: boolean;
    /** Set by `redactFor`: deck size, since the deck itself is stripped. */
    devDeckCount?: number;
  }
  interface Player {
    /** Resigned players are skipped in the turn order and cannot act. */
    resigned?: boolean;
    /** Set by `redactFor` so clients can render opponents' hand sizes. */
    handSize?: number;
    devCardCount?: number;
    progressCardCount?: number;
  }
}

declare module './engine' {
  interface Ctx {
    /**
     * The rules chain, most-specific-first. Passed down so a module can fire
     * lifecycle hooks without importing the registry that contains itself.
     */
    modules?: readonly RulesModule[];
  }
}

// ---------------------------------------------------------------------------

export function applyAction(
  state: GameState,
  action: GameAction,
  ctx?: Partial<Ctx>,
): ActionResult {
  const draft: GameState = structuredClone(state);
  const rng = ctx?.rng ?? rngFor(draft.options.seed, draft.rngCursor);
  const full: Ctx = {
    rng,
    now: ctx?.now ?? Date.now(),
    modules: ctx?.modules ?? RULES_MODULES,
  };

  let result: ActionResult | null = null;
  let handledBy: RulesModule | undefined;
  for (const module of full.modules!) {
    if (!module.handle || !module.enabled(draft)) continue;
    result = module.handle(draft, action, full);
    if (result) {
      handledBy = module;
      break;
    }
  }
  if (!result) return fail(`no rule handles "${action.type}"`);
  if (!result.ok) return result;

  const next = result.state;

  // Let the other modules react. Base first, so an expansion observes a state
  // the base game has already finished updating.
  for (const module of [...full.modules!].reverse()) {
    if (module === handledBy || !module.afterAction) continue;
    if (!module.enabled(next)) continue;
    module.afterAction(next, action, full);
  }
  next.rngCursor = rng.cursor;
  next.version = state.version + 1;

  // Awards and scores are re-derived rather than maintained, so a settlement
  // that cuts a road or a city that is destroyed can never leave them stale.
  updateAwards(next);
  applyScores(next, full.modules);
  checkVictory(next, full);

  return { ok: true, state: next };
}

/**
 * A player only wins on their own turn — points gained from a trade or a
 * stolen award on someone else's turn wait until the turn comes round.
 */
function checkVictory(state: GameState, ctx: Ctx): void {
  if (state.phase === 'game_over' || isSetupPhase(state.phase)) return;
  const player = state.players[state.currentPlayer];
  if (!player || player.resigned) return;
  const total = player.victoryPoints + player.hiddenPoints;
  if (total < state.options.victoryPointsToWin) return;
  state.winner = player.id;
  state.phase = 'game_over';
  state.log.push({
    turn: state.turn,
    playerId: player.id,
    message: `${player.name} wins with ${total} points`,
    at: ctx.now,
  });
}

/**
 * Replay a run of actions. Stops at the first failure and reports which one
 * broke, which is what test fixtures and the game log replayer want.
 */
export function applyActions(
  state: GameState,
  actions: readonly GameAction[],
  ctx?: Partial<Ctx>,
): ActionResult {
  let current = state;
  for (let i = 0; i < actions.length; i++) {
    const result = applyAction(current, actions[i], ctx);
    if (!result.ok) {
      return fail(`action ${i} (${actions[i].type}): ${result.error}`);
    }
    current = result.state;
  }
  return { ok: true, state: current };
}

/**
 * Every legal action, including those contributed by enabled expansions.
 * `legal.ts` exports the base-game version; this is the one the API and the
 * bots should call.
 */
export const allLegalActions = (
  state: GameState,
  playerId: PlayerId,
): GameAction[] => legalActions(state, playerId, RULES_MODULES);

export { RULES_MODULES };
