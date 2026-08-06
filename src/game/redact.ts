/**
 * Hidden information.
 *
 * The server holds the whole truth; a client is only ever sent what its own
 * player is entitled to see. This is the last thing that runs before state
 * goes over the wire, and it is deliberately a whitelist of what survives
 * rather than a blacklist of what to strip — a new secret field added to
 * `types.ts` should fail closed, not leak.
 *
 * What an opponent may see: how many cards you hold, how many development
 * cards you hold, and any development card you have already played. What they
 * may not: which cards those are, your unplayed development cards, your
 * progress cards, or anything still face-down on the board.
 */

import { totalCards } from './hand';
import type { GameState, PlayerId } from './types';

export function redactFor(state: GameState, playerId: PlayerId): GameState {
  const view: GameState = structuredClone(state);
  const revealEverything = view.phase === 'game_over';

  for (const player of view.players) {
    player.handSize = totalCards(player.hand);
    player.devCardCount = player.devCards.length;
    player.progressCardCount = player.progressCards?.length ?? 0;

    if (player.id === playerId || revealEverything) continue;

    player.hand = {};
    // A played card is public knowledge; an unplayed one is not, and a victory
    // point card is never played, so it stays hidden until the game ends.
    player.devCards = player.devCards.filter((c) => c.played);
    if (player.progressCards) player.progressCards = [];
  }

  // Deck order is the next few draws — knowing it is knowing the future.
  view.devDeckCount = view.devDeck.length;
  view.devDeck = [];
  if (view.progressDecks) {
    view.progressDecks = {
      trade: [],
      politics: [],
      science: [],
    };
  }

  // Seafarers fog: the terrain under an unexplored hex is not public.
  for (const hex of view.board.hexes) {
    if (hex.terrain === 'fog') delete hex.hidden;
  }

  return view;
}

/** Redact once per seat — what a server broadcast usually needs. */
export const redactForAll = (
  state: GameState,
): Record<PlayerId, GameState> =>
  Object.fromEntries(
    state.players.map((p) => [p.id, redactFor(state, p.id)]),
  );
