/**
 * PLACEHOLDER — replace me.
 *
 * This file exists only so the server can be built and played end to end
 * before the real bot policy lands. It makes the dumbest choice that can never
 * wedge a game: satisfy whatever the rules are waiting on, otherwise roll,
 * otherwise end the turn. It builds nothing and trades nothing outside setup.
 *
 * The contract the API depends on is `chooseAction(state, playerId)`, returning
 * a single action or `null` to mean "I have nothing to do". Bots are driven to
 * completion inside one request, so this must stay pure and cheap.
 */

import type { GameAction } from '../actions';
import { allLegalActions } from '../reducer';
import type { GameState, PlayerId } from '../types';

/** Things the rules are actively blocked on; they always come first. */
const REQUIRED: ReadonlySet<string> = new Set([
  'discard',
  'move_robber',
  'move_pirate',
  'steal',
  'choose_gold',
  'barbarian_loss',
  'respond_trade',
  'choose_metropolis',
]);

export function chooseAction(
  state: GameState,
  playerId: PlayerId,
): GameAction | null {
  const legal = allLegalActions(state, playerId);
  if (legal.length === 0) return null;

  const pick = (type: string) => legal.find((a) => a.type === type) ?? null;

  if (state.phase === 'setup_first' || state.phase === 'setup_second') {
    return (
      pick('build_settlement') ??
      pick('build_road') ??
      pick('build_ship') ??
      pick('end_turn')
    );
  }

  return (
    legal.find((a) => REQUIRED.has(a.type)) ?? pick('roll') ?? pick('end_turn')
  );
}
