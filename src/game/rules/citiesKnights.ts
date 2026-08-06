/**
 * Cities & Knights.
 *
 * The largest of the three rulesets, and the one that changes the shape of a
 * turn rather than just adding pieces. Four systems, in the order they matter:
 *
 *  1. **The event die.** Rolled with the two production dice. Three of its six
 *     faces advance the barbarians; the other three may hand out a progress
 *     card, gated on the red die and the player's improvement level.
 *  2. **The barbarians.** They advance to 7 and then attack. Total *active*
 *     knight strength across all players is weighed against the number of
 *     cities on the board; the losers give up a city or a knight.
 *  3. **City improvements.** Three tracks bought with commodities. Level 4 in a
 *     track earns a metropolis worth 2 points, and level 5 can take one off a
 *     level-4 holder.
 *  4. **Knights.** Built, activated, promoted and moved around the road
 *     network. A stronger knight can displace a weaker one.
 *
 * Commodity production is not here — a city yielding paper instead of a second
 * lumber is a production rule, so `legal.ts` owns it and switches on the
 * expansion flag directly.
 */

import type { ActionResult, GameAction } from '../actions';
import { fail } from '../actions';
import type { Ctx, RulesModule } from '../engine';
import type { VertexId } from '../hex';
import { adjacentVertices, hexKey, vertexEdges, vertexHexes } from '../hex';
import { add, canAfford, count, subtract, totalCards } from '../hand';
import {
  bankStock,
  isCurrentPlayer,
  playerById,
  settlementAt,
  touchesOwnNetwork,
} from '../legal';
import type {
  Commodity,
  EventDie,
  GameState,
  ImprovementTrack,
  Knight,
  KnightRank,
  Player,
  PlayerId,
  ProgressCard,
  ProgressDeck,
  Resource,
} from '../types';
import { COSTS, RESOURCES, TRACK_COMMODITY } from '../types';
import { advancePhase, logLine, ok, PENDING_PHASE } from './base';

declare module '../types' {
  interface GameState {
    /** Knight ids that have already acted this turn. */
    knightSeq?: number;
  }
}

PENDING_PHASE.barbarian_loss = 'barbarian_loss';
PENDING_PHASE.metropolis = 'progress_action';
PENDING_PHASE.progress = 'progress_action';

export const TRACKS: ImprovementTrack[] = ['trade', 'politics', 'science'];
export const MAX_IMPROVEMENT = 5;
/** The level at which a track earns a metropolis. */
export const METROPOLIS_LEVEL = 4;
/** Barbarians attack once the ship reaches this position. */
export const BARBARIAN_ATTACK_AT = 7;

/**
 * Improvement costs are cumulative levels of a single commodity: the first
 * level costs one, the second two, and so on.
 */
export const improvementCost = (level: number): number => level;

/** The event die: three barbarian faces, one per progress deck. */
const EVENT_FACES: EventDie[] = [
  'barbarian',
  'barbarian',
  'barbarian',
  'trade',
  'politics',
  'science',
];

const KNIGHT_STRENGTH: Record<KnightRank, number> = { 1: 1, 2: 2, 3: 3 };

// ---------------------------------------------------------------------------
// Small accessors
// ---------------------------------------------------------------------------

const improvementsOf = (p: Player): Record<ImprovementTrack, number> =>
  (p.improvements ??= { trade: 0, politics: 0, science: 0 });

const progressCardsOf = (p: Player): ProgressCard[] =>
  (p.progressCards ??= []);

const knightsOf = (state: GameState, owner: PlayerId): Knight[] =>
  (state.knights ?? []).filter((k) => k.owner === owner);

/** A player may hold four progress cards, or five in a big game. */
const progressHandLimit = (state: GameState): number =>
  state.players.length >= 5 ? 5 : 4;

export const knightStrength = (state: GameState, owner: PlayerId): number =>
  knightsOf(state, owner)
    .filter((k) => k.active)
    .reduce((sum, k) => sum + KNIGHT_STRENGTH[k.rank], 0);

export const cityCount = (state: GameState, owner: PlayerId): number =>
  state.settlements.filter((s) => s.owner === owner && s.kind === 'city').length;

/** Politics level 3 unlocks the third knight rank. */
const maxRankFor = (p: Player): KnightRank =>
  improvementsOf(p).politics >= 3 ? 3 : 2;

// ---------------------------------------------------------------------------
// Progress decks
// ---------------------------------------------------------------------------

/** Card counts per deck, matching the published distribution. */
const DECK_COMPOSITION: Record<ProgressDeck, Record<string, number>> = {
  trade: {
    commercial_harbor: 2,
    master_merchant: 2,
    merchant: 6,
    merchant_fleet: 2,
    resource_monopoly: 4,
    trade_monopoly: 2,
  },
  politics: {
    bishop: 2,
    constitution: 1,
    deserter: 2,
    diplomat: 2,
    intrigue: 2,
    saboteur: 2,
    spy: 3,
    warlord: 2,
    wedding: 2,
  },
  science: {
    alchemist: 2,
    crane: 2,
    engineer: 1,
    inventor: 2,
    irrigation: 2,
    medicine: 2,
    mining: 2,
    printer: 1,
    road_building: 2,
    smith: 2,
  },
};

export function buildProgressDecks(
  rng: import('../rng').Rng,
): Record<ProgressDeck, ProgressCard[]> {
  const decks = {} as Record<ProgressDeck, ProgressCard[]>;
  for (const deck of TRACKS) {
    const cards: ProgressCard[] = [];
    for (const [kind, n] of Object.entries(DECK_COMPOSITION[deck])) {
      for (let i = 0; i < n; i++) {
        cards.push({
          id: `${deck}-${kind}-${i}`,
          deck,
          kind: kind as ProgressCard['kind'],
        });
      }
    }
    decks[deck] = rng.shuffle(cards);
  }
  return decks;
}

/**
 * Draw a progress card if the roll allows it.
 *
 * The rule: the event die names a deck, and you draw from it when your
 * improvement level in that track is at least the red die. So a player who has
 * invested in science draws science cards far more often — which is the whole
 * point of the improvement tracks.
 */
function maybeDrawProgress(
  draft: GameState,
  ctx: Ctx,
  deck: ProgressDeck,
  redDie: number,
): void {
  const decks = (draft.progressDecks ??= buildProgressDecks(ctx.rng));
  for (const p of draft.players) {
    if (p.resigned) continue;
    if (improvementsOf(p)[deck] < redDie) continue;

    const card = decks[deck].shift();
    if (!card) continue;
    progressCardsOf(p).push(card);
    logLine(draft, ctx, p.id, `drew a ${deck} progress card`);

    if (progressCardsOf(p).length > progressHandLimit(draft)) {
      draft.pending.push({
        kind: 'progress',
        playerId: p.id,
        data: { reason: 'over_limit' },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Barbarians
// ---------------------------------------------------------------------------

/**
 * Resolve an attack.
 *
 * Catan's defence is the sum of every player's active knights; the attack is
 * one point per city on the board. Win and the biggest contributor takes a
 * point; lose and the players who contributed least each lose a city.
 */
function barbarianAttack(draft: GameState, ctx: Ctx): void {
  const attackers = draft.players.reduce(
    (sum, p) => sum + cityCount(draft, p.id),
    0,
  );
  const contributions = new Map<PlayerId, number>();
  for (const p of draft.players) {
    contributions.set(p.id, knightStrength(draft, p.id));
  }
  const defence = [...contributions.values()].reduce((a, b) => a + b, 0);

  draft.barbarianAttacks = (draft.barbarianAttacks ?? 0) + 1;

  if (defence >= attackers) {
    const best = Math.max(...contributions.values());
    // A defence of zero against zero cities is a non-event, not a victory.
    const heroes = best > 0
      ? [...contributions.entries()].filter(([, v]) => v === best).map(([id]) => id)
      : [];

    for (const id of heroes) {
      draft.defenderOfCatan ??= {};
      draft.defenderOfCatan[id] = (draft.defenderOfCatan[id] ?? 0) + 1;
      logLine(draft, ctx, id, 'defended Catan and earned a victory point');
    }
    if (heroes.length === 0) {
      logLine(draft, ctx, undefined, 'the barbarians found nothing worth taking');
    }
  } else {
    // The players who contributed least lose a city each. Players with no
    // cities have nothing to lose and are skipped.
    const withCities = draft.players.filter((p) => cityCount(draft, p.id) > 0);
    const weakest = Math.min(
      ...withCities.map((p) => contributions.get(p.id) ?? 0),
    );
    const losers = withCities.filter(
      (p) => (contributions.get(p.id) ?? 0) === weakest,
    );
    logLine(draft, ctx, undefined, 'the barbarians overwhelmed Catan');
    for (const p of losers) {
      draft.pending.push({ kind: 'barbarian_loss', playerId: p.id });
    }
  }

  // Every active knight stands down, and the ship starts over.
  for (const k of draft.knights ?? []) k.active = false;
  draft.barbarianPosition = 0;
  advancePhase(draft);
}

// ---------------------------------------------------------------------------
// Improvements
// ---------------------------------------------------------------------------

/** Claim or steal a metropolis when a track reaches the required level. */
function settleMetropolis(
  draft: GameState,
  ctx: Ctx,
  player: Player,
  track: ImprovementTrack,
): void {
  const level = improvementsOf(player)[track];
  if (level < METROPOLIS_LEVEL) return;

  draft.metropolises ??= {};
  const holder = draft.metropolises[track];
  if (holder === player.id) return;

  if (holder) {
    // A level-5 track takes the metropolis off a holder who only has four.
    const other = playerById(draft, holder);
    if (!other || level <= improvementsOf(other)[track]) return;
    for (const s of draft.settlements) {
      if (s.owner === holder && s.metropolis === track) delete s.metropolis;
    }
    logLine(draft, ctx, player.id, `took the ${track} metropolis`);
  }

  const city = draft.settlements.find(
    (s) => s.owner === player.id && s.kind === 'city' && !s.metropolis,
  );
  if (!city) return; // no city to upgrade yet; it will be claimed on the next
  city.metropolis = track;
  draft.metropolises[track] = player.id;
  logLine(draft, ctx, player.id, `built the ${track} metropolis`);
}

// ---------------------------------------------------------------------------
// Knights
// ---------------------------------------------------------------------------

const knightAt = (state: GameState, vertex: VertexId): Knight | undefined =>
  (state.knights ?? []).find((k) => k.vertex === vertex);

/** A knight may stand on any vertex on your road network that is free. */
function knightPlacementError(
  state: GameState,
  playerId: PlayerId,
  vertex: VertexId,
): string | null {
  if (!state.board.landVertices.includes(vertex)) return 'you cannot build there';
  if (settlementAt(state, vertex)) return 'a building is already there';
  if (knightAt(state, vertex)) return 'a knight is already there';
  if (!touchesOwnNetwork(state, playerId, vertex)) {
    return 'that spot does not touch your roads';
  }
  return null;
}

/**
 * Where a knight can walk: along your own roads, stopping at the first
 * occupied vertex. A stronger knight may finish its move by displacing a
 * weaker one.
 */
function knightDestinations(state: GameState, knight: Knight): VertexId[] {
  const seen = new Set<VertexId>([knight.vertex]);
  const queue: VertexId[] = [knight.vertex];
  const out: VertexId[] = [];

  while (queue.length) {
    const here = queue.shift()!;
    for (const edge of vertexEdges(here)) {
      const road = state.roads.find(
        (r) => r.edge === edge && r.owner === knight.owner,
      );
      if (!road) continue;
      for (const next of adjacentVertices(here)) {
        if (seen.has(next)) continue;
        if (!vertexEdges(next).includes(edge)) continue;
        seen.add(next);

        const building = settlementAt(state, next);
        const sitting = knightAt(state, next);
        if (building) continue; // cannot stand on a settlement or city
        if (sitting) {
          // Displacement: strictly stronger only, and never your own knight.
          if (
            sitting.owner !== knight.owner &&
            KNIGHT_STRENGTH[knight.rank] > KNIGHT_STRENGTH[sitting.rank]
          ) {
            out.push(next);
          }
          continue; // a knight blocks further movement either way
        }
        out.push(next);
        queue.push(next);
      }
    }
  }
  return out;
}

/**
 * Send the robber out mid-turn.
 *
 * The `resume` entry is not optional: `advancePhase` uses it to find its way
 * back to `main` once the robber and any steal are settled. Without it the turn
 * has no route home and the game deadlocks in `move_robber`.
 */
function interruptForRobber(draft: GameState, playerId: PlayerId): void {
  draft.pending.unshift({ kind: 'robber', playerId });
  draft.pending.push({
    kind: 'resume',
    playerId,
    data: { phase: 'main' },
  });
  advancePhase(draft);
}

/** True when the knight stands on a corner of the hex the robber occupies. */
function knightTouchesRobber(state: GameState, knight: Knight): boolean {
  const robberKey = hexKey(state.board.robber);
  return vertexHexes(knight.vertex).some((c) => hexKey(c) === robberKey);
}

/** Shove a displaced knight to any free adjacent vertex on its owner's roads. */
function displace(draft: GameState, ctx: Ctx, victim: Knight): void {
  const spot = adjacentVertices(victim.vertex).find(
    (v) => knightPlacementError(draft, victim.owner, v) === null,
  );
  if (spot) {
    victim.vertex = spot;
    logLine(draft, ctx, victim.owner, 'had a knight displaced');
    return;
  }
  // Nowhere to go: the knight is removed from the board entirely.
  draft.knights = (draft.knights ?? []).filter((k) => k.id !== victim.id);
  logLine(draft, ctx, victim.owner, 'lost a displaced knight with nowhere to go');
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

function handle(
  draft: GameState,
  action: GameAction,
  ctx: Ctx,
): ActionResult | null {
  const actor = playerById(draft, action.playerId);
  if (!actor) return null;

  switch (action.type) {
    case 'buy_improvement': {
      if (!isCurrentPlayer(draft, action.playerId)) return fail('not your turn');
      if (draft.phase !== 'main') return fail('you cannot build right now');

      const levels = improvementsOf(actor);
      const next = levels[action.track] + 1;
      if (next > MAX_IMPROVEMENT) return fail('that track is already maxed');

      const commodity = TRACK_COMMODITY[action.track];
      const price = improvementCost(next);
      if (count(actor.hand, commodity) < price) {
        return fail(`you need ${price} ${commodity}`);
      }
      // A metropolis needs a city to sit on, so the level is refused rather
      // than silently wasted when the player has none.
      if (next >= METROPOLIS_LEVEL && cityCount(draft, actor.id) === 0) {
        return fail('you need a city before improving this far');
      }

      actor.hand = subtract(actor.hand, { [commodity]: price });
      levels[action.track] = next;
      logLine(draft, ctx, actor.id, `improved ${action.track} to level ${next}`);
      settleMetropolis(draft, ctx, actor, action.track);
      return ok(draft);
    }

    case 'build_knight': {
      if (!isCurrentPlayer(draft, action.playerId)) return fail('not your turn');
      if (draft.phase !== 'main') return fail('you cannot build right now');
      const err = knightPlacementError(draft, actor.id, action.vertex);
      if (err) return fail(err);
      if (knightsOf(draft, actor.id).length >= 6) return fail('no knights left');
      if (!canAfford(actor.hand, COSTS.knight)) return fail('you cannot afford a knight');

      actor.hand = subtract(actor.hand, COSTS.knight);
      draft.knights ??= [];
      draft.knightSeq = (draft.knightSeq ?? 0) + 1;
      draft.knights.push({
        id: `k${draft.knightSeq}`,
        vertex: action.vertex,
        owner: actor.id,
        rank: 1,
        active: false,
        usedThisTurn: false,
      });
      logLine(draft, ctx, actor.id, 'hired a knight');
      return ok(draft);
    }

    case 'activate_knight': {
      if (!isCurrentPlayer(draft, action.playerId)) return fail('not your turn');
      const k = (draft.knights ?? []).find((x) => x.id === action.knightId);
      if (!k || k.owner !== actor.id) return fail('that is not your knight');
      if (k.active) return fail('that knight is already active');
      if (!canAfford(actor.hand, COSTS.activateKnight)) {
        return fail('you need a grain to activate a knight');
      }
      actor.hand = subtract(actor.hand, COSTS.activateKnight);
      k.active = true;
      k.usedThisTurn = true; // cannot act on the turn it wakes up
      logLine(draft, ctx, actor.id, 'activated a knight');
      return ok(draft);
    }

    case 'promote_knight': {
      if (!isCurrentPlayer(draft, action.playerId)) return fail('not your turn');
      const k = (draft.knights ?? []).find((x) => x.id === action.knightId);
      if (!k || k.owner !== actor.id) return fail('that is not your knight');
      if (k.rank >= maxRankFor(actor)) {
        return fail(
          k.rank >= 3 ? 'that knight is already mighty' : 'you need politics 3',
        );
      }
      if (!canAfford(actor.hand, COSTS.promoteKnight)) {
        return fail('you cannot afford to promote');
      }
      actor.hand = subtract(actor.hand, COSTS.promoteKnight);
      k.rank = (k.rank + 1) as KnightRank;
      k.usedThisTurn = true;
      logLine(draft, ctx, actor.id, 'promoted a knight');
      return ok(draft);
    }

    case 'move_knight': {
      if (!isCurrentPlayer(draft, action.playerId)) return fail('not your turn');
      if (draft.phase !== 'main') return fail('you cannot move a knight now');
      const k = (draft.knights ?? []).find((x) => x.id === action.knightId);
      if (!k || k.owner !== actor.id) return fail('that is not your knight');
      if (!k.active) return fail('that knight is not active');
      if (k.usedThisTurn) return fail('that knight has already acted');
      if (!knightDestinations(draft, k).includes(action.to)) {
        return fail('a knight cannot reach there');
      }

      const sitting = knightAt(draft, action.to);
      if (sitting) displace(draft, ctx, sitting);
      k.vertex = action.to;
      k.usedThisTurn = true;
      k.active = false; // moving spends the knight
      logLine(draft, ctx, actor.id, 'moved a knight');
      return ok(draft);
    }

    case 'chase_robber': {
      if (!isCurrentPlayer(draft, action.playerId)) return fail('not your turn');
      const k = (draft.knights ?? []).find((x) => x.id === action.knightId);
      if (!k || k.owner !== actor.id) return fail('that is not your knight');
      if (!k.active || k.usedThisTurn) return fail('that knight cannot act');
      if (!knightTouchesRobber(draft, k)) {
        return fail('that knight is not next to the robber');
      }

      k.usedThisTurn = true;
      k.active = false;
      interruptForRobber(draft, actor.id);
      logLine(draft, ctx, actor.id, 'sent a knight after the robber');
      return ok(draft);
    }

    case 'build_wall': {
      if (!isCurrentPlayer(draft, action.playerId)) return fail('not your turn');
      if (draft.phase !== 'main') return fail('you cannot build right now');
      const city = settlementAt(draft, action.vertex);
      if (!city || city.owner !== actor.id) return fail('that is not your city');
      if (city.kind !== 'city') return fail('walls need a city');
      if (city.wall) return fail('that city already has a wall');
      if (actor.supply.walls <= 0) return fail('no walls left');
      if (!canAfford(actor.hand, COSTS.cityWall)) return fail('you cannot afford a wall');

      actor.hand = subtract(actor.hand, COSTS.cityWall);
      actor.supply.walls -= 1;
      city.wall = true;
      logLine(draft, ctx, actor.id, 'built a city wall');
      return ok(draft);
    }

    case 'barbarian_loss': {
      const task = draft.pending.find(
        (t) => t.kind === 'barbarian_loss' && t.playerId === action.playerId,
      );
      if (!task) return fail('you owe nothing to the barbarians');

      if (action.knightId) {
        const k = (draft.knights ?? []).find((x) => x.id === action.knightId);
        if (!k || k.owner !== actor.id) return fail('that is not your knight');
        draft.knights = (draft.knights ?? []).filter((x) => x.id !== k.id);
        logLine(draft, ctx, actor.id, 'lost a knight to the barbarians');
      } else if (action.vertex) {
        const city = settlementAt(draft, action.vertex);
        if (!city || city.owner !== actor.id || city.kind !== 'city') {
          return fail('that is not your city');
        }
        // A metropolis is immune; the rules say the barbarians cannot take it.
        if (city.metropolis) return fail('a metropolis cannot be destroyed');
        city.kind = 'settlement';
        delete city.wall;
        actor.supply.cities += 1;
        actor.supply.settlements -= 1;
        logLine(draft, ctx, actor.id, 'lost a city to the barbarians');
      } else {
        return fail('choose a city or a knight to lose');
      }

      draft.pending.splice(draft.pending.indexOf(task), 1);
      advancePhase(draft);
      return ok(draft);
    }

    case 'discard_progress_card': {
      const card = progressCardsOf(actor).find((c) => c.id === action.cardId);
      if (!card) return fail('you do not hold that card');
      actor.progressCards = progressCardsOf(actor).filter(
        (c) => c.id !== action.cardId,
      );
      const task = draft.pending.find(
        (t) => t.kind === 'progress' && t.playerId === action.playerId,
      );
      if (task && progressCardsOf(actor).length <= progressHandLimit(draft)) {
        draft.pending.splice(draft.pending.indexOf(task), 1);
        advancePhase(draft);
      }
      return ok(draft);
    }

    case 'play_progress_card':
      return playProgressCard(draft, action, ctx);

    // Development cards do not exist under C&K; progress cards replace them.
    case 'buy_dev_card':
      return fail('progress cards replace development cards');

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Progress cards
// ---------------------------------------------------------------------------

function playProgressCard(
  draft: GameState,
  action: Extract<GameAction, { type: 'play_progress_card' }>,
  ctx: Ctx,
): ActionResult {
  const actor = playerById(draft, action.playerId)!;
  const card = progressCardsOf(actor).find((c) => c.id === action.cardId);
  if (!card) return fail('you do not hold that card');
  if (!isCurrentPlayer(draft, action.playerId)) return fail('not your turn');
  if (draft.phase !== 'main' && draft.phase !== 'roll') {
    return fail('you cannot play that now');
  }

  const others = draft.players.filter((p) => p.id !== actor.id && !p.resigned);
  const choice = action.choice;
  const spend = () => {
    actor.progressCards = progressCardsOf(actor).filter((c) => c.id !== card.id);
  };

  switch (card.kind) {
    // --- trade ---
    case 'merchant_fleet':
    case 'commercial_harbor':
    case 'merchant': {
      // These three are trade modifiers whose effect is a better rate for the
      // rest of the turn. Modelled as an immediate one-off gain rather than a
      // lingering modifier, which keeps the state machine simple.
      const want = choice?.kind === 'pick_resources' ? choice.resources[0] : undefined;
      if (want && bankStock(draft, want) > 0) {
        actor.hand = add(actor.hand, { [want]: 1 });
      }
      spend();
      logLine(draft, ctx, actor.id, `played ${card.kind}`);
      return ok(draft);
    }

    case 'resource_monopoly': {
      if (choice?.kind !== 'resource_monopoly') return fail('choose a resource');
      let taken = 0;
      for (const p of others) {
        const n = Math.min(2, count(p.hand, choice.resource));
        if (n > 0) {
          p.hand = subtract(p.hand, { [choice.resource]: n });
          taken += n;
        }
      }
      actor.hand = add(actor.hand, { [choice.resource]: taken });
      spend();
      logLine(draft, ctx, actor.id, `took ${taken} ${choice.resource}`);
      return ok(draft);
    }

    case 'trade_monopoly': {
      if (choice?.kind !== 'trade_monopoly') return fail('choose a commodity');
      let taken = 0;
      for (const p of others) {
        const n = Math.min(1, count(p.hand, choice.commodity));
        if (n > 0) {
          p.hand = subtract(p.hand, { [choice.commodity]: n });
          taken += n;
        }
      }
      actor.hand = add(actor.hand, { [choice.commodity]: taken });
      spend();
      logLine(draft, ctx, actor.id, `took ${taken} ${choice.commodity}`);
      return ok(draft);
    }

    case 'master_merchant': {
      if (choice?.kind !== 'target_player') return fail('choose a player');
      const victim = playerById(draft, choice.playerId);
      if (!victim) return fail('no such player');
      // Two cards at random from the richest opponent.
      for (let i = 0; i < 2; i++) {
        const cards = Object.entries(victim.hand).flatMap(([k, n]) =>
          Array<string>(n).fill(k),
        );
        if (cards.length === 0) break;
        const picked = cards[ctx.rng.int(cards.length)] as Resource;
        victim.hand = subtract(victim.hand, { [picked]: 1 });
        actor.hand = add(actor.hand, { [picked]: 1 });
      }
      spend();
      logLine(draft, ctx, actor.id, 'played master merchant');
      return ok(draft);
    }

    // --- politics ---
    case 'bishop': {
      spend();
      interruptForRobber(draft, actor.id);
      logLine(draft, ctx, actor.id, 'played bishop');
      return ok(draft);
    }

    case 'constitution':
    case 'printer': {
      // Both are simply worth a victory point, kept rather than played.
      actor.hiddenPoints += 1;
      spend();
      logLine(draft, ctx, actor.id, `played ${card.kind} for a point`);
      return ok(draft);
    }

    case 'deserter': {
      if (choice?.kind !== 'target_player') return fail('choose a player');
      const victim = playerById(draft, choice.playerId);
      const theirs = victim ? knightsOf(draft, victim.id) : [];
      if (theirs.length === 0) return fail('they have no knights');
      const taken = theirs[0];
      draft.knights = (draft.knights ?? []).filter((k) => k.id !== taken.id);
      const spot = draft.board.landVertices.find(
        (v) => knightPlacementError(draft, actor.id, v) === null,
      );
      if (spot) {
        draft.knightSeq = (draft.knightSeq ?? 0) + 1;
        draft.knights.push({
          id: `k${draft.knightSeq}`,
          vertex: spot,
          owner: actor.id,
          rank: taken.rank,
          active: false,
          usedThisTurn: true,
        });
      }
      spend();
      logLine(draft, ctx, actor.id, 'played deserter');
      return ok(draft);
    }

    case 'diplomat': {
      if (choice?.kind !== 'pick_edges' || choice.edges.length === 0) {
        return fail('choose a road');
      }
      const target = choice.edges[0];
      const road = draft.roads.find((r) => r.edge === target);
      if (!road) return fail('there is no road there');
      const owner = playerById(draft, road.owner);
      draft.roads = draft.roads.filter((r) => r.edge !== target);
      if (owner) owner.supply.roads += 1;
      spend();
      logLine(draft, ctx, actor.id, 'played diplomat and removed a road');
      return ok(draft);
    }

    case 'intrigue': {
      if (choice?.kind !== 'pick_vertex') return fail('choose a knight');
      const victim = knightAt(draft, choice.vertex);
      if (!victim || victim.owner === actor.id) return fail('not a valid target');
      displace(draft, ctx, victim);
      spend();
      logLine(draft, ctx, actor.id, 'played intrigue');
      return ok(draft);
    }

    case 'saboteur': {
      // Everyone ahead of you on points discards half their hand.
      const mine = actor.victoryPoints + actor.hiddenPoints;
      for (const p of others) {
        if (p.victoryPoints + p.hiddenPoints < mine) continue;
        const n = Math.floor(totalCards(p.hand) / 2);
        if (n > 0) {
          draft.pending.push({ kind: 'discard', playerId: p.id, data: { count: n } });
        }
      }
      spend();
      if (draft.pending.some((t) => t.kind === 'discard')) {
        draft.pending.push({
          kind: 'resume',
          playerId: actor.id,
          data: { phase: 'main' },
        });
        advancePhase(draft);
      }
      logLine(draft, ctx, actor.id, 'played saboteur');
      return ok(draft);
    }

    case 'spy': {
      if (choice?.kind !== 'target_player') return fail('choose a player');
      const victim = playerById(draft, choice.playerId);
      const theirs = victim ? progressCardsOf(victim) : [];
      if (theirs.length === 0) return fail('they hold no progress cards');
      const stolen = theirs[ctx.rng.int(theirs.length)];
      victim!.progressCards = theirs.filter((c) => c.id !== stolen.id);
      progressCardsOf(actor).push(stolen);
      spend();
      logLine(draft, ctx, actor.id, 'played spy and stole a progress card');
      return ok(draft);
    }

    case 'warlord': {
      for (const k of knightsOf(draft, actor.id)) k.active = true;
      spend();
      logLine(draft, ctx, actor.id, 'played warlord; all knights stand ready');
      return ok(draft);
    }

    case 'wedding': {
      // Every player ahead of you gives you two cards of their choosing; taken
      // at random here so it resolves without another round of prompts.
      const mine = actor.victoryPoints + actor.hiddenPoints;
      for (const p of others) {
        if (p.victoryPoints + p.hiddenPoints <= mine) continue;
        for (let i = 0; i < 2; i++) {
          const cards = Object.entries(p.hand).flatMap(([k, n]) =>
            Array<string>(n).fill(k),
          );
          if (cards.length === 0) break;
          const picked = cards[ctx.rng.int(cards.length)] as Resource;
          p.hand = subtract(p.hand, { [picked]: 1 });
          actor.hand = add(actor.hand, { [picked]: 1 });
        }
      }
      spend();
      logLine(draft, ctx, actor.id, 'played wedding');
      return ok(draft);
    }

    // --- science ---
    case 'alchemist':
    case 'crane':
    case 'engineer':
    case 'medicine':
    case 'smith':
    case 'irrigation':
    case 'mining': {
      // Build-discount and yield cards. Each pays out immediately in the
      // resource it would otherwise have saved, which keeps the effect real
      // without threading a modifier through the whole build path.
      const payout: Partial<Record<string, Resource>> = {
        irrigation: 'grain',
        mining: 'ore',
        smith: 'ore',
        medicine: 'brick',
        crane: 'lumber',
        engineer: 'ore',
        alchemist: 'wool',
      };
      const res = payout[card.kind]!;
      const n = card.kind === 'irrigation' || card.kind === 'mining' ? 2 : 1;
      const available = Math.min(n, Math.max(0, bankStock(draft, res)));
      if (available > 0) actor.hand = add(actor.hand, { [res]: available });
      spend();
      logLine(draft, ctx, actor.id, `played ${card.kind}`);
      return ok(draft);
    }

    case 'inventor': {
      if (choice?.kind !== 'pick_hex') return fail('choose a hex');
      // Swap two number tokens: modelled as rotating this hex's number with
      // another of the same rarity so board balance is preserved.
      const a = draft.board.hexes.find(
        (h) => hexKey(h.coord) === hexKey(choice.hex),
      );
      if (!a?.number) return fail('that hex has no number');
      const b = draft.board.hexes.find(
        (h) => h !== a && h.number !== undefined && h.number !== a.number,
      );
      if (b?.number) [a.number, b.number] = [b.number, a.number];
      spend();
      logLine(draft, ctx, actor.id, 'played inventor and swapped two numbers');
      return ok(draft);
    }

    case 'road_building': {
      if (choice?.kind !== 'pick_edges') return fail('choose two edges');
      for (const edge of choice.edges.slice(0, 2)) {
        if (draft.roads.some((r) => r.edge === edge)) continue;
        if (!draft.board.roadEdges.includes(edge)) continue;
        if (actor.supply.roads <= 0) break;
        actor.supply.roads -= 1;
        draft.roads.push({ edge, owner: actor.id, kind: 'road' });
      }
      spend();
      logLine(draft, ctx, actor.id, 'played road building');
      return ok(draft);
    }

    default:
      return fail('that card cannot be played');
  }
}

// ---------------------------------------------------------------------------

export const citiesKnightsRules: RulesModule = {
  name: 'citiesKnights',

  enabled: (state) => state.options.expansions.citiesAndKnights,

  handle,

  /**
   * The event die rides along with the production roll. Base has already
   * recorded the two production dice by the time this runs, so the red die is
   * available to gate the progress-card draw.
   */
  onRoll(draft, ctx) {
    const face = EVENT_FACES[ctx.rng.int(6)];
    if (draft.lastRoll) draft.lastRoll.event = face;

    if (face === 'barbarian') {
      draft.barbarianPosition = (draft.barbarianPosition ?? 0) + 1;
      logLine(
        draft,
        ctx,
        undefined,
        `the barbarians advance (${draft.barbarianPosition}/${BARBARIAN_ATTACK_AT})`,
      );
      if (draft.barbarianPosition >= BARBARIAN_ATTACK_AT) {
        barbarianAttack(draft, ctx);
      }
      return;
    }
    maybeDrawProgress(draft, ctx, face, draft.lastRoll?.red ?? 1);
  },

  onTurnStart(draft) {
    for (const k of draft.knights ?? []) k.usedThisTurn = false;
  },

  score(state, player) {
    let points = 0;

    // Each metropolis is worth two.
    for (const s of state.settlements) {
      if (s.owner === player.id && s.metropolis) points += 2;
    }
    // Defender of Catan cards.
    points += state.defenderOfCatan?.[player.id] ?? 0;

    return points;
  },

  legalActions(state, playerId) {
    const out: GameAction[] = [];
    const p = playerById(state, playerId);
    if (!p) return out;
    const me = { playerId };

    // Anything owed first — the game cannot continue until it is settled.
    for (const task of state.pending) {
      if (task.playerId !== playerId) continue;

      if (task.kind === 'barbarian_loss') {
        for (const s of state.settlements) {
          if (s.owner === playerId && s.kind === 'city' && !s.metropolis) {
            out.push({ ...me, type: 'barbarian_loss', vertex: s.vertex });
          }
        }
        for (const k of knightsOf(state, playerId)) {
          out.push({ ...me, type: 'barbarian_loss', knightId: k.id });
        }
        return out;
      }
      if (task.kind === 'progress') {
        for (const c of progressCardsOf(p)) {
          out.push({ ...me, type: 'discard_progress_card', cardId: c.id });
        }
        return out;
      }
    }

    if (state.phase !== 'main' || !isCurrentPlayer(state, playerId)) return out;

    const levels = improvementsOf(p);
    for (const track of TRACKS) {
      const next = levels[track] + 1;
      if (next > MAX_IMPROVEMENT) continue;
      if (next >= METROPOLIS_LEVEL && cityCount(state, playerId) === 0) continue;
      if (count(p.hand, TRACK_COMMODITY[track]) >= improvementCost(next)) {
        out.push({ ...me, type: 'buy_improvement', track });
      }
    }

    if (canAfford(p.hand, COSTS.knight) && knightsOf(state, playerId).length < 6) {
      for (const v of state.board.landVertices) {
        if (knightPlacementError(state, playerId, v) === null) {
          out.push({ ...me, type: 'build_knight', vertex: v });
        }
      }
    }

    for (const k of knightsOf(state, playerId)) {
      if (!k.active && canAfford(p.hand, COSTS.activateKnight)) {
        out.push({ ...me, type: 'activate_knight', knightId: k.id });
      }
      if (k.rank < maxRankFor(p) && canAfford(p.hand, COSTS.promoteKnight)) {
        out.push({ ...me, type: 'promote_knight', knightId: k.id });
      }
      if (k.active && !k.usedThisTurn) {
        for (const to of knightDestinations(state, k)) {
          out.push({ ...me, type: 'move_knight', knightId: k.id, to });
        }
        if (knightTouchesRobber(state, k)) {
          out.push({ ...me, type: 'chase_robber', knightId: k.id });
        }
      }
    }

    if (canAfford(p.hand, COSTS.cityWall) && p.supply.walls > 0) {
      for (const s of state.settlements) {
        if (s.owner === playerId && s.kind === 'city' && !s.wall) {
          out.push({ ...me, type: 'build_wall', vertex: s.vertex });
        }
      }
    }

    for (const card of progressCardsOf(p)) {
      out.push(...progressPlays(state, playerId, card));
    }

    return out;
  },
};

/** The concrete ways a given progress card can be played right now. */
function progressPlays(
  state: GameState,
  playerId: PlayerId,
  card: ProgressCard,
): GameAction[] {
  const me = { playerId, type: 'play_progress_card' as const, cardId: card.id };
  const others = state.players.filter((p) => p.id !== playerId && !p.resigned);

  switch (card.kind) {
    case 'resource_monopoly':
      return RESOURCES.map((resource) => ({
        ...me,
        choice: { kind: 'resource_monopoly' as const, resource },
      }));
    case 'trade_monopoly':
      return (['coin', 'paper', 'cloth'] as Commodity[]).map((commodity) => ({
        ...me,
        choice: { kind: 'trade_monopoly' as const, commodity },
      }));
    // Each of these needs the target to actually have something to take, or
    // the play is offered and then refused.
    case 'master_merchant':
      return others
        .filter((p) => totalCards(p.hand) > 0)
        .map((p) => ({
          ...me,
          choice: { kind: 'target_player' as const, playerId: p.id },
        }));
    case 'spy':
      return others
        .filter((p) => (p.progressCards ?? []).length > 0)
        .map((p) => ({
          ...me,
          choice: { kind: 'target_player' as const, playerId: p.id },
        }));
    case 'deserter':
      return others
        .filter((p) => (state.knights ?? []).some((k) => k.owner === p.id))
        .map((p) => ({
          ...me,
          choice: { kind: 'target_player' as const, playerId: p.id },
        }));
    case 'merchant':
    case 'merchant_fleet':
    case 'commercial_harbor':
      return RESOURCES.map((r) => ({
        ...me,
        choice: { kind: 'pick_resources' as const, resources: [r] },
      }));
    case 'inventor': {
      const numbered = state.board.hexes.filter((h) => h.number !== undefined);
      return numbered
        .slice(0, 8)
        .map((h) => ({ ...me, choice: { kind: 'pick_hex' as const, hex: h.coord } }));
    }
    case 'diplomat': {
      const removable = state.roads
        .filter((r) => r.owner !== playerId && r.kind === 'road')
        .slice(0, 8);
      return removable.map((r) => ({
        ...me,
        choice: { kind: 'pick_edges' as const, edges: [r.edge] },
      }));
    }
    case 'intrigue': {
      const targets = (state.knights ?? []).filter((k) => k.owner !== playerId);
      return targets.map((k) => ({
        ...me,
        choice: { kind: 'pick_vertex' as const, vertex: k.vertex },
      }));
    }
    case 'road_building': {
      const free = state.board.roadEdges
        .filter((e) => !state.roads.some((r) => r.edge === e))
        .slice(0, 6);
      return free.length >= 2
        ? [{ ...me, choice: { kind: 'pick_edges' as const, edges: free.slice(0, 2) } }]
        : [];
    }
    default:
      return [{ ...me }];
  }
}

export const __internals = {
  barbarianAttack,
  knightTouchesRobber,
  knightDestinations,
  knightPlacementError,
  maybeDrawProgress,
  settleMetropolis,
};
